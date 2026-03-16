import express from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();

/**
 * GET /addresses
 * Get all addresses of logged-in user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(addresses);
  } catch (error) {
    console.error('Get addresses error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * POST /addresses
 * Add new address
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { label, address, lat, lng, isDefault } = req.body;

    if (!label || !address) {
      return res.status(400).json({ error: 'Label and address are required' });
    }

    const newAddress = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId: req.user.id },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId: req.user.id,
          label,
          address,
          lat,
          lng,
          isDefault: Boolean(isDefault),
        },
      });
    });

    res.status(201).json(newAddress);
  } catch (error) {
    console.error('Create address error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PUT /addresses/:id
 * Update address
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, address, lat, lng, isDefault } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId: req.user.id },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          ...(label !== undefined && { label }),
          ...(address !== undefined && { address }),
          ...(lat !== undefined && { lat }),
          ...(lng !== undefined && { lng }),
          ...(isDefault !== undefined && { isDefault }),
        },
      });
    });

    res.json(updated);
  } catch (error) {
    console.error('Update address error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * DELETE /addresses/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await prisma.address.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Delete address error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
