import express from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';
import upload from '../middleware/upload.middleware.js';
import { deleteImageFromCloudinary } from '../utils/image.js';

const router = express.Router();

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        full_name: true,
        role: true,
        profile_image: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.put('/me', authenticate, async (req, res) => {
  try {
    // const { full_name, phone } = req.body;
    const { name, full_name, phone } = req.body;


    const user = await prisma.user.update({
      where: { id: req.user.id },
      // data: {
      //   ...(full_name !== undefined && { full_name: full_name || null }),
      //   ...(phone !== undefined && { phone: phone || null })
      // },
      data: {
  ...(name !== undefined && { name: name || null }),
  ...(full_name !== undefined && { full_name: full_name || null }),
  ...(phone !== undefined && { phone: phone || null }),
},
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        full_name: true,
        role: true,
        profile_image: true
      }
    });

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.put('/me/avatar', authenticate, upload.single('profile_image'), async (req, res) => {
  try {
    let imageUrl = req.body.imageUrl || req.body.profile_image;

    // If a file was uploaded, use the Cloudinary URL
    if (req.file) {
      imageUrl = req.file.path;
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Get current user to check for old image
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { profile_image: true }
    });

    // Delete old image from Cloudinary if it exists and is different from new image
    if (currentUser?.profile_image && currentUser.profile_image !== imageUrl) {
      await deleteImageFromCloudinary(currentUser.profile_image);
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        profile_image: imageUrl
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        full_name: true,
        role: true,
        profile_image: true
      }
    });

    res.json({
      message: 'Profile image updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile image error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;
