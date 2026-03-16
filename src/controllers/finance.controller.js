import prisma from '../config/database.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

export const getWallet = async (req, res) => {
  try {
    const { role, id } = req.user;
    let whereClause = {};

    if (role === 'RESTAURANT') {
      const { restaurantId } = req.query;

      if (restaurantId) {
        // Verify ownership
        const restaurant = await prisma.restaurant.findUnique({
             where: { id: restaurantId }
        });
        
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
        if (restaurant.ownerId !== id) return res.status(403).json({ error: 'Unauthorized: You do not own this restaurant' });
        
        whereClause = { restaurantId };
      } else {
        // Fallback to first restaurant (legacy)
        const restaurant = await prisma.restaurant.findFirst({ where: { ownerId: id } });
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
        whereClause = { restaurantId: restaurant.id };
      }
    } else if (role === 'DELIVERY_PARTNER') {
      whereClause = { userId: id };
    } else {
        // Admin or User - mostly admin checking global, but this route seems tailored for personal wallet
        // Users might have wallets later.
        whereClause = { userId: id }; 
    }

    const wallet = await prisma.wallet.findUnique({
      where: whereClause,
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        payouts: {
            orderBy: { createdAt: 'desc' },
            take: 20
        }
      }
    });

    if (!wallet) {
       // Return empty wallet structure if not found (lazy creation logic on order completion, but good to handle here)
       return res.json({ balance: 0, transactions: [], payouts: [] });
    }

    res.json(wallet);
  } catch (error) {
    console.error('Get Wallet Error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
};

export const requestPayout = async (req, res) => {
  try {
    const { role, id } = req.user;
    let wallet;

    if (role === 'RESTAURANT') {
        const restaurant = await prisma.restaurant.findFirst({ where: { ownerId: id } });
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
        wallet = await prisma.wallet.findUnique({ where: { restaurantId: restaurant.id } });
    } else {
        wallet = await prisma.wallet.findUnique({ where: { userId: id } });
    }

    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    if (wallet.balance <= 0) return res.status(400).json({ error: 'Insufficient balance' });

    // Check if there is already a pending payout?
    const pendingPayout = await prisma.payout.findFirst({
        where: { walletId: wallet.id, status: 'REQUESTED' }
    });
    
    if (pendingPayout) return res.status(400).json({ error: 'A payout request is already pending' });

    const payout = await prisma.payout.create({
      data: {
        walletId: wallet.id,
        amount: wallet.balance, // Request full balance
        status: 'REQUESTED'
      }
    });

    res.status(201).json({ message: 'Payout requested successfully', payout });
  } catch (error) {
    console.error('Request Payout Error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
};

export const processPayout = async (req, res) => {
    try {
        const { payoutId } = req.body;
        
        // Admin only route
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const payout = await prisma.payout.findUnique({
            where: { id: payoutId },
            include: { wallet: true }
        });

        if (!payout) return res.status(404).json({ error: 'Payout request not found' });
        if (payout.status !== 'REQUESTED') return res.status(400).json({ error: 'Payout already processed or failed' });

        // Simulate Bank Transfer here
        // In real world, call Stripe Connect Payout API
        
        await prisma.$transaction([
            // 1. Update Payout Status
            prisma.payout.update({
                where: { id: payoutId },
                data: { 
                    status: 'PROCESSED', 
                    processedAt: new Date(),
                    transactionReference: `SIM_TR_${Date.now()}` 
                }
            }),
            // 2. Deduct from Wallet
            prisma.wallet.update({
                where: { id: payout.walletId },
                data: { balance: { decrement: payout.amount } }
            }),
            // 3. Log Debit Transaction
            prisma.transaction.create({
                data: {
                    walletId: payout.walletId,
                    type: 'PAYOUT',
                    amount: payout.amount,
                    description: `Payout processed (Ref: ${payoutId})`
                }
            })
        ]);

        res.json({ message: 'Payout processed successfully' });

    } catch (error) {
        console.error('Process Payout Error:', error);
        const { statusCode, message } = mapPrismaError(error);
        res.status(statusCode).json({ error: message });
    }
};

export const getAdminStats = async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized' });

        // Total Commission Revenue
        // Sum of all commission transactions?
        // Actually we don't have a platform wallet yet. 
        // We can sum (Order Total * 0.20) for all completed orders OR sum 'COMMISSION_DEBIT' if we had that.
        // Wait, in my order completion, I only credited the Restaurant net amount. I didn't create a "Platform Wallet".
        // So validation of revenue is tricky directly from Wallets.
        // But we can check Order table for COMPLETED orders.
        
        const completedOrders = await prisma.order.findMany({
            where: { status: 'COMPLETED' },
            select: { totalAmount: true }
        });

        const totalRevenue = completedOrders.reduce((acc, order) => acc + order.totalAmount, 0);
        const platformIncome = totalRevenue * 0.20; // Simulated 20%

        // Pending Payouts
        const pendingPayouts = await prisma.payout.findMany({
            where: { status: 'REQUESTED' },
            include: { 
                wallet: {
                    include: {
                        restaurant: { select: { name: true } },
                        user: { select: { name: true, role: true } } 
                    }
                }
            }
        });

        res.json({
            totalRevenue: platformIncome,
            pendingPayouts
        });

    } catch (error) {
        console.error('Admin Stats Error:', error);
        const { statusCode, message } = mapPrismaError(error);
        res.status(statusCode).json({ error: message });
    }
};
