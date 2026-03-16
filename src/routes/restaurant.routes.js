import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
// import { isRestaurantOpen } from '../utils/restaurantTime.utils.js';
import { isRestaurantOpenNow } from '../utils/restaurantTime.js';
import upload from '../middleware/upload.middleware.js';
import { deleteImageFromCloudinary } from '../utils/image.js';
import { emitToAdmin } from '../config/socket.js';
import { mapPrismaError } from '../utils/prismaErrors.js';


const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { isOpen, search, cuisine, minRating, priceRange } = req.query;

    const where = {};

    if (isOpen !== undefined) {
      where.isOpen = isOpen === 'true';
    } else {
      where.isOpen = true;
    }

    // Only show verified restaurants in the public listing
    where.isVerified = true;

    if (search) {
      where.name = {
        contains: search,
        mode: 'insensitive'
      };
    }

    if (cuisine) {
      where.cuisine = {
        contains: cuisine,
        mode: 'insensitive'
      };
    }

    if (priceRange) {
      where.priceRange = {
        contains: priceRange,
        mode: 'insensitive'
      };
    }

    const restaurants = await prisma.restaurant.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

const restaurantsWithRating = await Promise.all(
  restaurants.map(async (restaurant) => {
    const ratingData = await prisma.review.aggregate({
      where: { restaurantId: restaurant.id },
      _avg: { rating: true },
      _count: true,
    });

   return {
  ...restaurant,
  isOpenNow: isRestaurantOpenNow(
    restaurant.openingTime,
    restaurant.closingTime
  ),
  averageRating: ratingData._avg.rating || null,
  totalReviews: ratingData._count
};

  })
);


    if (minRating) {
      const minVal = parseFloat(minRating);
      const filtered = restaurantsWithRating.filter(
        r => r.averageRating === null || r.averageRating >= minVal
      );
      return res.json(filtered);
    }

    res.json(restaurantsWithRating || []);
  } catch (error) {
    console.error('Get restaurants error:', error);
    res.status(500).json({ error: 'Failed to fetch restaurants' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        categories: {
          include: {
            menuItems: {
              where: { isAvailable: true }
            }
          }
        }
      }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const ratingData = await prisma.review.aggregate({
      where: { restaurantId: id },
      _avg: { rating: true },
      _count: true
    });

    res.json({
      ...restaurant,
      averageRating: ratingData._avg.rating || null,
      totalReviews: ratingData._count
    });
  } catch (error) {
    console.error('Get restaurant error:', error);
    res.status(500).json({ error: 'Failed to fetch restaurant' });
  }
});

router.get('/owner/restaurants', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      where: { ownerId: req.user.id },
      select: {
  id: true,
  name: true,
  isOpen: true,
  createdAt: true,
  cuisine: true,
  phone: true, // ✅ ADDED
  address: true,
  description: true,
  imageUrl: true
},
      orderBy: { createdAt: 'desc' }
    });

    res.json(restaurants || []);
  } catch (error) {
    console.error('Get owner restaurants error:', error);
    res.status(500).json({ error: 'Failed to fetch your restaurants' });
  }
});

router.post('/:id/reviews', authenticate, authorize('USER'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'Rating is required' });
    }

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const userOrder = await prisma.order.findFirst({
      where: {
        userId: req.user.id,
        restaurantId: id
      }
    });

    if (!userOrder) {
      return res.status(403).json({ error: 'You can only review restaurants you have ordered from' });
    }

    const review = await prisma.review.upsert({
      where: {
        userId_restaurantId: {
          userId: req.user.id,
          restaurantId: id
        }
      },
      update: {
        rating,
        comment: comment || null
      },
      create: {
        rating,
        comment: comment || null,
        userId: req.user.id,
        restaurantId: id
      }
    });

    res.status(201).json({
      message: 'Review submitted successfully',
      review
    });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.get('/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const reviews = await prisma.review.findMany({
      where: { restaurantId: id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(reviews || []);
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.post('/', authenticate, authorize('RESTAURANT', 'ADMIN'), upload.single('imageUrl'), async (req, res) => {
  try {
    const {
  name,
  description,
  isOpen,
  address,
  cuisine,
  deliveryTime,
  priceRange,
  rating,
  lat,
  lng
} = req.body;

    let imageUrl = req.body.imageUrl;
    if (req.file) {
      imageUrl = req.file.path;
    }


    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

      if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const restaurant = await prisma.restaurant.create({
      data: {
  name,
  description,
  isOpen: typeof isOpen === 'string' ? isOpen === 'true' : (isOpen !== undefined ? isOpen : true),
  ownerId: req.user.id,

  address,
  cuisine,
  deliveryTime,
  imageUrl,
  priceRange,
  rating: rating ? parseFloat(rating) : undefined,
  lat: lat ? parseFloat(lat) : undefined,
  lng: lng ? parseFloat(lng) : undefined
},
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Notify Admin about new restaurant
    emitToAdmin('NEW_RESTAURANT', {
      restaurantId: restaurant.id,
      name: restaurant.name,
      owner: req.user.name,
      message: `New restaurant created: ${restaurant.name}`
    });

    res.status(201).json({
      message: 'Restaurant created successfully',
      restaurant
    });
  } catch (error) {
    console.error('Create restaurant error:', error);
    res.status(500).json({ error: 'Failed to create restaurant' });
  }
});

router.put('/:id', authenticate, authorize('RESTAURANT', 'ADMIN'), upload.single('imageUrl'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
  name,
  description,
  cuisine,
  address,
  area,
  city,
  lat,
  lng
} = req.body;

    let imageUrl = req.body.imageUrl;
    if (req.file) {
      imageUrl = req.file.path;
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only update your own restaurant' });
    }

    // Delete old image if new one is uploaded
    if (req.file && restaurant.imageUrl && restaurant.imageUrl !== imageUrl) {
      await deleteImageFromCloudinary(restaurant.imageUrl);
    }

    const updated = await prisma.restaurant.update({
      where: { id },
      data: {
        name,
        description,
        cuisine,
        address,
        area,
        city,
        lat: lat ? parseFloat(lat) : undefined,
        lng: lng ? parseFloat(lng) : undefined,
        imageUrl,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update restaurant error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});


router.patch('/:id/status', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { isOpen } = req.body;

    if (isOpen === undefined) {
      return res.status(400).json({ error: 'isOpen status is required' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only modify your own restaurant' });
    }

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { isOpen: Boolean(isOpen) },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Return the updated object directly to match frontend expectations and other API endpoints
    res.json(updated);
  } catch (error) {
    console.error('Update restaurant status error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/:id/reviews/eligibility', authenticate, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const userId = req.user.id;

    const order = await prisma.order.findFirst({
      where: {
        restaurantId,
        userId,
      },
    });

    res.json({
      canReview: Boolean(order),
    });
  } catch (error) {
    console.error('Review eligibility error:', error);
    res.status(500).json({ error: 'Failed to check review eligibility' });
  }
});


export default router;
