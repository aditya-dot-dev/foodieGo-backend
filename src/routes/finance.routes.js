import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';
import { getWallet, requestPayout, processPayout, getAdminStats } from '../controllers/finance.controller.js';

const router = express.Router();

// Get Wallet Balance & History (Restaurant, Delivery Partner)
router.get('/wallet', authenticate, getWallet);

// Request Payout (Restaurant, Delivery Partner)
router.post('/payout/request', authenticate, requestPayout);

// Admin: Process Payout
router.post('/admin/payout/process', authenticate, authorize('ADMIN'), processPayout);

// Admin: Get Financial Stats
router.get('/admin/stats', authenticate, authorize('ADMIN'), getAdminStats);

export default router;
