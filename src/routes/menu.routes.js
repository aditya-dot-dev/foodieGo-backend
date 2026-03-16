import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';
import upload from '../middleware/upload.middleware.js';
import { deleteImageFromCloudinary } from '../utils/image.js';

const router = express.Router();

router.post('/:restaurantId/menu/categories', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (restaurant.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only manage your own restaurant' });
    }

    const category = await prisma.menuCategory.create({
      data: {
        name,
        restaurantId
      }
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.post('/:restaurantId/menu/items', authenticate, authorize('RESTAURANT', 'ADMIN'), upload.single('imageUrl'), async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { name, price, categoryId, isAvailable } = req.body;

    let imageUrl = req.body.imageUrl;
    if (req.file) {
      imageUrl = req.file.path;
    }

    if (!name || price === undefined || !categoryId) {
      return res.status(400).json({ error: 'Name, price, and categoryId are required' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (restaurant.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only manage your own restaurant' });
    }

    const category = await prisma.menuCategory.findUnique({
      where: { id: categoryId }
    });

    if (!category || category.restaurantId !== restaurantId) {
      return res.status(404).json({ error: 'Category not found in this restaurant' });
    }

    const menuItem = await prisma.menuItem.create({
      data: {
        name,
        price: parseFloat(price),
        categoryId,
        imageUrl: imageUrl || null,
        isAvailable: isAvailable !== undefined ? isAvailable : true
      }
    });

    res.status(201).json(menuItem);
  } catch (error) {
    console.error('Create menu item error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/:id/menu', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch restaurant directly from DB with no recomputation
    // Must use same data source as GET /restaurants to ensure isOpen consistency
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
        }
      }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Fetch menu categories with available items only
    const menu = await prisma.menuCategory.findMany({
      where: { restaurantId: id },
      include: {
        menuItems: {
          where: { isAvailable: true },
          select: {
            id: true,
            name: true,
            price: true,
            isAvailable: true
          },
          orderBy: { name: 'asc' }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      restaurant,
      menu: menu || []
    });
  } catch (error) {
    console.error('Fetch menu error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/categories/:restaurantId', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only access your own restaurant' });
    }

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { name: 'asc' }
    });

    res.json(categories || []);
  } catch (error) {
    console.error('Get categories error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/items/:categoryId', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { categoryId } = req.params;

    const category = await prisma.menuCategory.findUnique({
      where: { id: categoryId },
      include: { restaurant: true }
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only access your own restaurant' });
    }

    const items = await prisma.menuItem.findMany({
      where: { categoryId },
      orderBy: { createdAt: 'asc' }
    });

    res.json(items || []);
  } catch (error) {
    console.error('Fetch menu items error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.delete('/categories/:id', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.menuCategory.findUnique({
      where: { id },
      include: { restaurant: true }
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only delete your own restaurant categories' });
    }

    await prisma.menuCategory.delete({
      where: { id }
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.delete('/items/:id', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    const item = await prisma.menuItem.findUnique({
      where: { id },
      include: {
        category: {
          include: { restaurant: true }
        }
      }
    });

    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    if (item.category.restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You can only delete your own restaurant items' });
    }

    if (item.imageUrl) {
      await deleteImageFromCloudinary(item.imageUrl);
    }

    await prisma.menuItem.delete({
      where: { id }
    });

    res.json({ message: 'Menu item deleted successfully' });
  } catch (error) {
    console.error('Delete menu item error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
