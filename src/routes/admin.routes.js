import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();

// Apply admin protection to all routes in this file
router.use(authenticate, authorize('ADMIN'));

/**
 * GET /admin/stats
 * Get high-level platform statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      totalRestaurants,
      totalOrders,
      totalRevenue,
      usersByRole,
      ordersByStatus
    ] = await Promise.all([
      prisma.user.count(),
      prisma.restaurant.count(),
      prisma.order.count(),
      prisma.order.aggregate({
        where: { paymentStatus: 'SUCCEEDED' },
        _sum: { totalAmount: true }
      }),
      prisma.user.groupBy({
        by: ['role'],
        _count: true
      }),
      prisma.order.groupBy({
        by: ['status'],
        _count: true
      })
    ]);

    const totalRevenueValue = totalRevenue._sum.totalAmount || 0;
    const platformCommission = totalRevenueValue * 0.20; // 20% platform fee

    res.json({
      totalUsers,
      totalRestaurants,
      totalOrders,
      totalRevenue: totalRevenueValue,
      platformCommission,
      usersByRole,
      ordersByStatus
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /admin/restaurants
 * List all restaurants with owner info
 */
router.get('/restaurants', async (req, res) => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        _count: {
          select: {
            categories: true,
            orders: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(restaurants);
  } catch (error) {
    console.error('Admin restaurants error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /admin/restaurants/:id/toggle-status
 * Admin can force open/close a restaurant
 */
router.patch('/restaurants/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;
    const restaurant = await prisma.restaurant.findUnique({ where: { id } });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const updatedRestaurant = await prisma.restaurant.update({
      where: { id },
      data: { isOpen: !restaurant.isOpen },
      include: {
        owner: {
          select: { name: true, email: true }
        }
      }
    });

    res.json({
      message: `Restaurant ${updatedRestaurant.isOpen ? 'opened' : 'closed'} successfully`,
      restaurant: updatedRestaurant
    });
  } catch (error) {
    console.error('Admin toggle status error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /admin/restaurants/:id/toggle-verification
 * Toggle the verified status of a restaurant
 */
router.patch('/restaurants/:id/toggle-verification', async (req, res) => {
  try {
    const { id } = req.params;
    const restaurant = await prisma.restaurant.findUnique({ where: { id } });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const updatedRestaurant = await prisma.restaurant.update({
      where: { id },
      data: { isVerified: !restaurant.isVerified },
      include: {
        owner: {
          select: { name: true, email: true }
        }
      }
    });

    res.json({
      message: `Restaurant ${updatedRestaurant.isVerified ? 'verified' : 'unverified'} successfully`,
      restaurant: updatedRestaurant
    });
  } catch (error) {
    console.error('Admin toggle verify error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /admin/users
 * List all users with role filtering
 */
router.get('/users', async (req, res) => {
  try {
    const { role, status } = req.query;
    const where = {};
    if (role) where.role = role;
    
    // Filter by verification status if provided
    if (status === 'pending') {
      where.isVerified = false;
      where.role = { in: ['RESTAURANT', 'DELIVERY_PARTNER'] }; // Only these roles need manual verification
    } else if (status === 'verified') {
      where.isVerified = true;
    }

    console.log('GET /admin/users query:', req.query);
    console.log('computed where:', where);

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isVerified: true,
        isAvailable: true,
        vehicleType: true,
        vehicleNumber: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
            restaurants: true,
            deliveryOrders: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(users);
  } catch (error) {
    console.error('Admin users error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /admin/users/:id/verify
 * Verify a user (Restaurant Owner or Delivery Partner)
 */
router.patch('/users/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!['RESTAURANT', 'DELIVERY_PARTNER'].includes(user.role)) {
      return res.status(400).json({
        error: 'Only RESTAURANT and DELIVERY_PARTNER accounts can be verified from this endpoint'
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isVerified: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isVerified: true
      }
    });

    res.json({
      message: `${updatedUser.role} verified successfully`,
      user: updatedUser
    });
  } catch (error) {
    console.error('Admin verify user error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * DELETE /admin/users/:id/reject
 * Reject a user (Delete the account)
 */
router.delete('/users/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First check if user exists and is pending
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isVerified) {
        return res.status(400).json({ error: 'Cannot reject an already verified user' });
    }

    // Delete the user
    await prisma.user.delete({ where: { id } });

    res.json({
      message: `${user.role} application rejected and removed`,
      userId: id
    });
  } catch (error) {
    console.error('Admin reject user error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /admin/coupons
 * List all coupons on the platform (Global + Restaurant specific)
 */
router.get('/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        user: {
          select: { name: true, email: true }
        },
        restaurant: {
          select: { name: true }
        },
        orderItems: {
          include: { menuItem: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    console.error('Admin orders error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/coupons', async (req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({
      include: {
        restaurant: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(coupons);
  } catch (error) {
    console.error('Admin coupons error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
