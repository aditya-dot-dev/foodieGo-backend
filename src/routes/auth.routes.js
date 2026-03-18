import express from 'express';
import bcrypt from "bcryptjs";
import prisma from '../config/database.js';
import { generateToken } from '../utils/jwt.utils.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { emitToAdmin } from '../config/socket.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, role, vehicleType, vehicleNumber } = req.body;
    const normalizedRole = typeof role === 'string' ? role.toUpperCase() : 'USER';
    const allowedPublicRoles = ['USER', 'RESTAURANT', 'DELIVERY_PARTNER'];

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!allowedPublicRoles.includes(normalizedRole)) {
      return res.status(400).json({
        error: 'Invalid role selected',
        message: 'You can register only as USER, RESTAURANT, or DELIVERY_PARTNER'
      });
    }

    // Validate delivery partner fields
    if (normalizedRole === 'DELIVERY_PARTNER') {
      if (!vehicleType || !vehicleNumber) {
        return res.status(400).json({
          error: 'Vehicle details are required for delivery partners',
          message: 'Please provide vehicle type and vehicle number'
        });
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userData = {
      name,
      email,
      phone,
      password: hashedPassword,
      role: normalizedRole,
      isVerified: normalizedRole === 'USER' // Auto-verify regular users, force verification for others
    };

    // Add delivery partner specific fields
    if (normalizedRole === 'DELIVERY_PARTNER') {
      userData.vehicleType = vehicleType;
      userData.vehicleNumber = vehicleNumber;
      userData.isAvailable = false; // Default to offline
    }

    const user = await prisma.user.create({
      data: userData
    });

    // Notify Admin about new user
    emitToAdmin('NEW_USER', {
      userId: user.id,
      name: user.name,
      role: user.role,
      message: `New ${user.role} registered: ${user.name}`
    });

    // Response based on verification status
    if (user.isVerified) {
      const token = generateToken(user);

      return res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          vehicleType: user.vehicleType,
          vehicleNumber: user.vehicleNumber
        }
      });
    }

    return res.status(201).json({
      message: 'Registration successful. Please wait for admin approval.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login Api 
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      console.log('Login failed: User not found for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Login attempt:', { email, role: user.role, isVerified: user.isVerified });

    // Check verification status for all roles
    if (!user.isVerified) {
      console.log('Login blocked: User not verified');
      return res.status(403).json({
        error: 'Account pending verification',
        message: 'Your account is pending admin approval. Please wait for verification.'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful' });
});

export default router;
