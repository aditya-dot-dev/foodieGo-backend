import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();

// GET /api/coupons - List coupons
router.get('/', async (req, res) => {
  try {
    const { ownerId, restaurantId, ownerRestaurantId } = req.query;
    let where = {};

    // 1. Owner Dashboard View: Fetch all coupons for a specific restaurant (owner's selected restaurant)
    //    PLus Global Coupons (read-only for owner)
    if (ownerRestaurantId) {
      where = {
        OR: [
          { restaurantId: String(ownerRestaurantId) },
          { restaurantId: null } // Global coupons
        ]
      };
    }
    // 2. Legacy: ownerId - finds first restaurant for that owner (deprecated, use ownerRestaurantId)
    else if (ownerId) {
      const restaurant = await prisma.restaurant.findFirst({
        where: { ownerId: String(ownerId) }
      });
      
      if (restaurant) {
        where = { restaurantId: restaurant.id };
      } else {
        return res.json([]); 
      }
    } 
    // 3. Customer View: Fetch Global Coupons + Specific Restaurant Coupons
    else if (restaurantId) {
       where = {
         isActive: true,
         expiresAt: { gt: new Date() },
         OR: [
           { restaurantId: null }, // Global coupons
           { restaurantId: String(restaurantId) } // Specific to this restaurant
         ]
       };
    }
    // 4. General "Offers" Page View: Global Coupons Only
    else {
      where = {
        isActive: true,
        expiresAt: { gt: new Date() },
        restaurantId: null
      };
    }

    const coupons = await prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json(coupons);
  } catch (error) {
    console.error('List coupons error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/coupons - Create a new coupon (Admin/Restaurant only)
router.post('/', authenticate, authorize('ADMIN', 'RESTAURANT'), async (req, res) => {
  try {
    const { code, discountType, discountAmount, minOrderValue, maxDiscount, expiresAt, description, restaurantId: bodyRestaurantId } = req.body;

    let restaurantId = null;

    // If Restaurant Owner, verify they own the specified restaurant (or find their restaurant)
    if (req.user.role === 'RESTAURANT') {
      if (bodyRestaurantId) {
        // Validate that the owner owns this restaurant
        const restaurant = await prisma.restaurant.findFirst({
          where: { 
            id: bodyRestaurantId,
            ownerId: req.user.id 
          }
        });

        if (!restaurant) {
          return res.status(403).json({ error: 'You do not own this restaurant' });
        }
        restaurantId = restaurant.id;
      } else {
        // Fallback: find their first restaurant (legacy behavior)
        const restaurant = await prisma.restaurant.findFirst({
          where: { ownerId: req.user.id }
        });

        if (!restaurant) {
          return res.status(404).json({ error: 'No restaurant found for this owner' });
        }
        restaurantId = restaurant.id;
      }
    }

    const existing = await prisma.coupon.findFirst({
      where: { 
        code: code.toUpperCase(),
        // Unique per restaurant? Or generally unique? Schema says `code` is unique globally.
        // Assuming global uniqueness for simplicity for now.
      }
    });

    if (existing) {
      return res.status(400).json({ error: 'Coupon code already exists' });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        discountType,
        discountAmount: parseFloat(discountAmount),
        minOrderValue: parseFloat(minOrderValue) || 0,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        expiresAt: new Date(expiresAt),
        description,
        restaurantId // Link to restaurant if applicable
      }
    });

    res.status(201).json(coupon);
  } catch (error) {
    console.error('Create coupon error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/coupons/apply - Validate and apply coupon
router.post('/apply', authenticate, async (req, res) => {
  try {
    const { code, cartValue } = req.body;

    if (!code || !cartValue) {
      return res.status(400).json({ error: 'Code and cart value are required' });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (!coupon) {
      return res.status(404).json({ error: 'Invalid coupon code' });
    }

    if (!coupon.isActive) {
      return res.status(400).json({ error: 'Coupon is inactive' });
    }

    if (new Date() > coupon.expiresAt) {
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    if (cartValue < coupon.minOrderValue) {
      return res.status(400).json({ 
        error: `Minimum order value of ₹${coupon.minOrderValue} required` 
      });
    }

    // Calculate discount
    let discount = 0;
    if (coupon.discountType === 'FLAT') {
      discount = coupon.discountAmount;
    } else {
      discount = (cartValue * coupon.discountAmount) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    }

    // Ensure discount doesn't exceed cart value
    discount = Math.min(discount, cartValue);

    res.json({
      code: coupon.code,
      discount,
      finalTotal: cartValue - discount,
      message: 'Coupon applied successfully'
    });

  } catch (error) {
    console.error('Apply coupon error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// PUT /api/coupons/:id - Update coupon
router.put('/:id', authenticate, authorize('ADMIN', 'RESTAURANT'), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, discountType, discountAmount, minOrderValue, maxDiscount, expiresAt, isActive, description } = req.body;

    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    // Ownership check
    if (req.user.role === 'RESTAURANT') {
      if (!coupon.restaurantId) {
        return res.status(403).json({ error: 'You cannot edit global coupons' });
      }
      const restaurant = await prisma.restaurant.findFirst({
        where: { id: coupon.restaurantId, ownerId: req.user.id }
      });
      if (!restaurant) return res.status(403).json({ error: 'You do not own the restaurant for this coupon' });
    }

    // Update coupon
    const updateData = {};
    if (code) updateData.code = code.toUpperCase();
    if (discountType) updateData.discountType = discountType;
    if (discountAmount !== undefined) updateData.discountAmount = parseFloat(discountAmount);
    if (minOrderValue !== undefined) updateData.minOrderValue = parseFloat(minOrderValue);
    if (maxDiscount !== undefined) updateData.maxDiscount = maxDiscount === null ? null : parseFloat(maxDiscount);
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (description !== undefined) updateData.description = description;

    const updated = await prisma.coupon.update({
      where: { id },
      data: updateData
    });

    res.json(updated);
  } catch (error) {
    console.error('Update coupon error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

// DELETE /api/coupons/:id - Delete coupon (Soft delete)
router.delete('/:id', authenticate, authorize('ADMIN', 'RESTAURANT'), async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    // Ownership check
    if (req.user.role === 'RESTAURANT') {
      if (!coupon.restaurantId) {
        return res.status(403).json({ error: 'You cannot delete global coupons' });
      }
      const restaurant = await prisma.restaurant.findFirst({
        where: { id: coupon.restaurantId, ownerId: req.user.id }
      });
      if (!restaurant) return res.status(403).json({ error: 'You do not own the restaurant for this coupon' });
    }

    // Soft delete
    await prisma.coupon.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Delete coupon error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
