import express from 'express';
import Stripe from 'stripe';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  canCancelOrder,
  calculateRefundAmount,
  validateCancellationRequest
} from '../utils/cancellationPolicy.js';
import { mapPrismaError } from '../utils/prismaErrors.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
import { broadcastToDeliveryPartners } from '../config/socket.js';

router.post('/', authenticate, async (req, res) => {
  try {
    const { restaurantId, items, addressId } = req.body;

    if (!restaurantId || !items || !Array.isArray(items) || items.length === 0 || !addressId) {
      return res.status(400).json({ error: 'Restaurant ID, items, and delivery address are required' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    if (!restaurant.isOpen) {
      return res.status(400).json({ error: 'Restaurant is currently closed' });
    }

    const menuItemIds = items.map(item => item.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        isAvailable: true
      }
    });

    if (menuItems.length !== menuItemIds.length) {
      return res.status(400).json({ error: 'Some menu items are not available' });
    }

    const menuItemMap = new Map(menuItems.map(item => [item.id, item]));

    let totalAmount = 0;
    const orderItemsData = items.map(item => {
      const menuItem = menuItemMap.get(item.menuItemId);
      const itemTotal = menuItem.price * item.quantity;
      totalAmount += itemTotal;

      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: menuItem.price
      };
    });

    // Handle Coupon
    if (req.body.couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: req.body.couponCode.toUpperCase() }
      });

      if (coupon && coupon.isActive && new Date() <= coupon.expiresAt && totalAmount >= coupon.minOrderValue) {
        let discount = 0;
        if (coupon.discountType === 'FLAT') {
          discount = coupon.discountAmount;
        } else {
          discount = (totalAmount * coupon.discountAmount) / 100;
          if (coupon.maxDiscount) {
            discount = Math.min(discount, coupon.maxDiscount);
          }
        }
        totalAmount = Math.max(0, totalAmount - discount);
      }
    }

    const order = await prisma.order.create({
      data: {
        userId: req.user.id,
        restaurantId,
        addressId,
        status: 'PLACED',
        totalAmount,
        deliveryFee: 40.0, // Standard delivery fee
        paymentStatus: 'PENDING',
        orderItems: {
          create: orderItemsData
        }
      },
      include: {
        orderItems: {
          include: {
            menuItem: true
          }
        },
        restaurant: {
          select: {
            id: true,
            name: true,
            description: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Order created successfully. Please proceed to payment.',
      order,
      requiresPayment: true
    });
  } catch (error) {
    console.error('Create order error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get('/my', authenticate, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true,
            description: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true
              }
            }
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});


router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            lat: true,
            lng: true,
            address: true,
            phone: true // ✅ ADDED
          }
        },
        address: true, // ✅ ADDED
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true
                // isVeg: true // Field not in schema yet
              }
            }
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' }
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Authorization check: User can only see their own orders (unless admin/restaurant owner logic extends this)
    // For simplicity allowing user or if they are the owner of the restaurant
    if (order.userId !== req.user.id && req.user.role !== 'ADMIN') {
       // Also check if it's the restaurant owner
       const restaurant = await prisma.restaurant.findUnique({ where: { id: order.restaurantId }});
       if (!restaurant || restaurant.ownerId !== req.user.id) {
         return res.status(403).json({ error: 'Unauthorized to view this order' });
       }
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

router.get('/restaurant', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { ownerId: req.user.id }
    });

    if (!restaurant) {
      return res.status(404).json({
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant not found'
      });
    }

    const where = { 
      restaurantId: restaurant.id,
      // Only show orders that are fully paid
      paymentStatus: 'SUCCEEDED'
    };
    if (status) {
      where.status = status;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(orders);
  } catch (error) {
    console.error('Get restaurant orders error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

router.get(
  '/restaurant/:restaurantId',
  authenticate,
  authorize('RESTAURANT', 'ADMIN'),
  async (req, res) => {
    const { restaurantId } = req.params;

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: restaurantId,
        ownerId: req.user.id,
      },
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const orders = await prisma.order.findMany({
      where: { 
        restaurantId,
        paymentStatus: 'SUCCEEDED'
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        orderItems: {
          include: { menuItem: { select: { id: true, name: true } } },
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(orders);
  }
);


const validStatusTransitions = {
  PLACED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['PREPARING', 'REJECTED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: []
};

router.patch('/:id/status', authenticate, authorize('RESTAURANT', 'ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: 'Status is required'
      });
    }

    const validStatuses = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { restaurant: true }
    });

    if (!order) {
      return res.status(404).json({
        error: 'ORDER_NOT_FOUND',
        message: 'Order not found'
      });
    }

    if (order.restaurant.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'UNAUTHORIZED_ACTION',
        message: 'You can only update orders from your restaurant'
      });
    }

    if (!validStatusTransitions[order.status].includes(status)) {
      return res.status(400).json({
        error: 'INVALID_STATUS_TRANSITION',
        message: `Invalid transition: ${order.status} → ${status}. Allowed: ${validStatusTransitions[order.status].join(', ')}`
      });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: status,
          changedBy: req.user.id
        }
      });

      return tx.order.update({
        where: { id },
        data: { status },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true
            }
          },
          orderItems: {
            include: {
              menuItem: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          restaurant: {
            select: {
              id: true,
              name: true
            }
          },
          statusHistory: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });
    });

    // Notify User
    sendToUser(updatedOrder.userId, 'ORDER_STATUS_UPDATE', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      message: `Your order is now ${status.toLowerCase()}`,
      order: updatedOrder
    });

    // Notify Restaurant
    emitToRestaurant(updatedOrder.restaurantId, 'ORDER_STATUS_UPDATE', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      message: `Order status updated to ${status.toLowerCase()}`,
      order: updatedOrder
    });

    // HANDLE REFUNDS FOR REJECTION/CANCELLATION
    if (['REJECTED', 'CANCELLED'].includes(status)) {
      try {
        // Check if order was paid
        if (updatedOrder.paymentStatus === 'SUCCEEDED' && updatedOrder.paymentIntentId) {
          console.log(`Processing auto-refund for ${status} order ${updatedOrder.id}`);
          
          // Process Stripe Refund
          const refund = await stripe.refunds.create({
            payment_intent: updatedOrder.paymentIntentId,
            reason: status === 'REJECTED' ? 'requested_by_customer' : 'duplicate', // mapping for Stripe
            metadata: {
              orderId: updatedOrder.id,
              reason: `Order ${status} by ${req.user.role}`
            }
          });

          // Update Order and Payment records with refund info
          await prisma.$transaction([
            prisma.order.update({
              where: { id: updatedOrder.id },
              data: {
                refundStatus: 'PROCESSING',
                refundAmount: updatedOrder.totalAmount, // Full refund for rejection
                cancellationReason: status === 'REJECTED' ? 'Restaurant rejected the order' : 'Cancelled by Admin'
              }
            }),
            prisma.payment.update({
              where: { paymentIntentId: updatedOrder.paymentIntentId },
              data: {
                status: 'REFUNDED',
                refundAmount: updatedOrder.totalAmount,
                refundedAt: new Date()
              }
            })
          ]);

          // Notify User about refund
          sendToUser(updatedOrder.userId, 'ORDER_REFUND_INITIATED', {
            orderId: updatedOrder.id,
            amount: updatedOrder.totalAmount,
            message: `Your order was ${status.toLowerCase()}. A full refund has been initiated.`
          });
        }
      } catch (refundError) {
        console.error('Auto-refund failed:', refundError);
        // We log it but don't revert the status change, as the order IS rejected physically.
        // Admin might need to intervene manually.
      }
    }

    // HANDLE FINANCIAL TRANSACTIONS ON COMPLETION
    // Commission Structure (Swiggy model):
    // - Restaurant: 80% of food purchase (totalAmount)
    // - Platform: 20% of food purchase (totalAmount)
    // - Delivery Partner: 100% of delivery fee (no platform commission)
    if (status === 'COMPLETED') {
      try {
        const orderTotal = updatedOrder.totalAmount; // Food items only (after coupon)
        const commissionRate = 0.20; // 20% platform commission on food
        const commissionAmount = orderTotal * commissionRate;
        const restaurantEarning = orderTotal - commissionAmount;

        // 1. Credit Restaurant Wallet
        let restaurantWallet = await prisma.wallet.findUnique({
          where: { restaurantId: updatedOrder.restaurantId }
        });

        if (!restaurantWallet) {
          restaurantWallet = await prisma.wallet.create({
            data: { restaurantId: updatedOrder.restaurantId }
          });
        }

        await prisma.$transaction([
          prisma.wallet.update({
            where: { id: restaurantWallet.id },
            data: { balance: { increment: restaurantEarning } }
          }),
          prisma.transaction.create({
            data: {
              walletId: restaurantWallet.id,
              type: 'ORDER_CREDIT',
              amount: restaurantEarning,
              description: `Earnings from Order #${updatedOrder.id}`,
              referenceId: updatedOrder.id
            }
          })
        ]);

        console.log(`Credited ${restaurantEarning} to Restaurant ${updatedOrder.restaurantId}`);

        // 2. Credit Delivery Partner Wallet (if assigned)
        if (updatedOrder.deliveryPartnerId) {
            // Use delivery fee from order record (default: 40 INR)
            // Platform takes 0% commission on delivery fee - goes 100% to driver
            const deliveryFee = updatedOrder.deliveryFee || 40.0;
            
            let driverWallet = await prisma.wallet.findUnique({
                where: { userId: updatedOrder.deliveryPartnerId }
            });

            if (!driverWallet) {
                driverWallet = await prisma.wallet.create({
                    data: { userId: updatedOrder.deliveryPartnerId }
                });
            }

             await prisma.$transaction([
                prisma.wallet.update({
                    where: { id: driverWallet.id },
                    data: { balance: { increment: deliveryFee } }
                }),
                prisma.transaction.create({
                    data: {
                        walletId: driverWallet.id,
                        type: 'ORDER_CREDIT',
                        amount: deliveryFee,
                        description: `Delivery Fee for Order #${updatedOrder.id}`,
                        referenceId: updatedOrder.id
                    }
                })
            ]);
            console.log(`Credited ${deliveryFee} to Delivery Partner ${updatedOrder.deliveryPartnerId}`);
        }

      } catch (finError) {
        console.error('Error processing financial transactions:', finError);
        // Don't fail the request, just log error. In prod, we'd need a retry mechanism.
      }
    }

    // If order is READY, notify all delivery partners
    if (status === 'READY') {
      broadcastToDeliveryPartners('NEW_AVAILABLE_ORDER', {
        orderId: updatedOrder.id,
        restaurantName: updatedOrder.restaurant.name,
        message: 'New order ready for pickup!'
      });
    }

    res.json({
      message: `Order status updated to ${status}`,
      order: updatedOrder
    });
  } catch (error) {
    console.error('Update order status error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * POST /orders/:orderId/cancel
 * Cancel an order and process refund
 */
router.post('/:orderId/cancel', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    // Fetch order with all necessary data
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        restaurant: {
          select: { id: true, name: true }
        },
        orderItems: {
          include: {
            menuItem: {
              select: { id: true, name: true, price: true }
            }
          }
        },
        payment: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Validate cancellation request
    const validation = validateCancellationRequest(order, req.user.id);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Calculate refund amount
    const { refundAmount, refundPercentage } = calculateRefundAmount(order);

    if (refundAmount === 0) {
      return res.status(400).json({ 
        error: 'Cancellation window expired',
        message: 'Orders can only be cancelled within 5 minutes of placement'
      });
    }

    // Process Stripe refund
    let stripeRefund = null;
    if (order.paymentIntentId && refundAmount > 0) {
      try {
        stripeRefund = await stripe.refunds.create({
          payment_intent: order.paymentIntentId,
          amount: Math.round(refundAmount * 100), // Convert to paise
          reason: 'requested_by_customer',
          metadata: {
            orderId: order.id,
            userId: req.user.id,
            originalAmount: order.totalAmount,
            refundPercentage
          }
        });
      } catch (stripeError) {
        console.error('Stripe refund error:', stripeError);
        return res.status(500).json({ 
          error: 'Failed to process refund',
          message: 'Payment refund failed. Please contact support.'
        });
      }
    }

    // Update order and payment in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Add status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          changedBy: req.user.id
        }
      });

      // Update order
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason || 'Customer requested cancellation',
          cancelledBy: req.user.id,
          refundAmount,
          refundStatus: stripeRefund ? 'PROCESSING' : 'PENDING'
        },
        include: {
          restaurant: {
            select: { id: true, name: true }
          },
          orderItems: {
            include: {
              menuItem: {
                select: { id: true, name: true, price: true }
              }
            }
          }
        }
      });

      // Update payment record if exists
      if (order.payment) {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: {
            status: 'REFUNDED',
            refundAmount,
            refundedAt: new Date()
          }
        });
      }

      return updatedOrder;
    });

    // Notify other party
    const notificationTarget = req.user.id === result.userId ? result.restaurantId : result.userId;
    const notificationEvent = req.user.id === result.userId ? 'ORDER_CANCELLED_BY_USER' : 'ORDER_CANCELLED_BY_RESTAURANT';
    
    if (req.user.id === result.userId) {
      emitToRestaurant(result.restaurantId, 'ORDER_CANCELLED', {
        orderId: result.id,
        message: 'A customer has cancelled their order'
      });
    } else {
      sendToUser(result.userId, 'ORDER_CANCELLED', {
        orderId: result.id,
        message: 'The restaurant has cancelled your order'
      });
    }

    res.json({
      message: 'Order cancelled successfully',
      refundAmount,
      refundPercentage,
      refundStatus: stripeRefund ? 'PROCESSING' : 'PENDING',
      stripeRefundId: stripeRefund?.id,
      order: result
    });

  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ 
      error: 'Failed to cancel order',
      message: error.message 
    });
  }
});

export default router;
