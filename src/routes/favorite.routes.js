import express from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();

// POST /api/favorites/:restaurantId - Toggle favorite
router.post('/:restaurantId', authenticate, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const userId = req.user.id;

    // Check if restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Check if favorite exists
    const existing = await prisma.favorite.findUnique({
      where: {
        userId_restaurantId: {
          userId,
          restaurantId
        }
      }
    });

    if (existing) {
      // Remove favorite
      await prisma.favorite.delete({
        where: { id: existing.id }
      });
      return res.json({ favorited: false, message: 'Removed from favorites' });
    } else {
      // Add favorite
      await prisma.favorite.create({
        data: {
          userId,
          restaurantId
        }
      });
      return res.status(201).json({ favorited: true, message: 'Added to favorites' });
    }
  } catch (error) {
    console.error('Toggle favorite error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/favorites - List user's favorite restaurants
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        restaurant: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Return just the restaurant objects
    res.json(favorites.map(f => f.restaurant));
  } catch (error) {
    console.error('List favorites error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/favorites/ids - List just the IDs of favorited restaurants (useful for UI sync)
router.get('/ids', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      select: { restaurantId: true }
    });

    res.json(favorites.map(f => f.restaurantId));
  } catch (error) {
    console.error('Get favorite IDs error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
