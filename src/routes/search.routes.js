import express from 'express';
import prisma from '../config/database.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.json([]);
    }

    const searchBuffer = q.trim();
    if (searchBuffer.length < 2) {
        return res.json([]);
    }

    const menuItems = await prisma.menuItem.findMany({
      where: {
        AND: [
          {
            isAvailable: true
          },
          {
            OR: [
              { name: { contains: searchBuffer, mode: 'insensitive' } },
              { category: { name: { contains: searchBuffer, mode: 'insensitive' } } }
            ]
          }
        ]
      },
      include: {
        category: {
            select: { name: true }
        },
        category: {
            include: {
                 restaurant: {
                    select: {
                        id: true,
                        name: true,
                        imageUrl: true,
                        rating: true,
                        deliveryTime: true,
                        priceRange: true,
                        cuisine: true
                    }
                 }
            }
        }
      },
      take: 50
    });

    // Transform result to be more frontend friendly if needed, or just send as is
    // Flattening structure slightly for easier consumption:
    const results = menuItems.map(item => ({
        ...item,
        restaurant: item.category.restaurant
    }));

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
