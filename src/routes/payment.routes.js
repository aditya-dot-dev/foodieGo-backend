import express from 'express';
import Stripe from 'stripe';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { sendToUser, emitToRestaurant } from '../config/socket.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /payment/create-intent
 * Create a payment intent for an order
 */
router.post('/create-intent', authenticate, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    // Get the order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        restaurant: {
          select: { id: true, name: true }
        },
        orderItems: {
          include: {
            menuItem: {
              select: { name: true }
            }
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user owns this order
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to pay for this order' });
    }

    // Check if order already has a payment intent
    if (order.paymentIntentId) {
      // Retrieve existing payment intent
      const existingIntent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
      
      return res.json({
        clientSecret: existingIntent.client_secret,
        paymentIntentId: existingIntent.id,
        amount: existingIntent.amount
      });
    }

    // Create payment intent
    const amount = Math.round(order.totalAmount * 100); // Convert to paise/cents

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'inr',
      metadata: {
        orderId: order.id,
        userId: order.userId,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurant.name
      },
      description: `Order from ${order.restaurant.name}`,
      receipt_email: order.user.email || undefined
    });

    // Update order with payment intent ID
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentIntentId: paymentIntent.id,
        paymentStatus: 'PROCESSING'
      }
    });

    // Create payment record
    await prisma.payment.create({
      data: {
        orderId: order.id,
        amount: order.totalAmount,
        currency: 'inr',
        status: 'PROCESSING',
        paymentIntentId: paymentIntent.id
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount
    });

  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ 
      error: 'Failed to create payment intent',
      message: error.message 
    });
  }
});

/**
 * POST /payment/confirm
 * Confirm payment was successful (called from frontend after Stripe confirmation)
 */
router.post('/confirm', authenticate, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment Intent ID is required' });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        error: 'Payment not successful',
        status: paymentIntent.status 
      });
    }

    // Find order by payment intent ID
    const order = await prisma.order.findFirst({
      where: { paymentIntentId }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user owns this order
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update order and payment status
    const updatedOrder = await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          stripePaymentId: paymentIntent.id,
          paidAt: new Date()
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
      }),
      prisma.payment.update({
        where: { paymentIntentId },
        data: {
          status: 'SUCCEEDED',
          stripePaymentId: paymentIntent.id,
          paymentMethod: paymentIntent.payment_method_types?.[0] || 'card'
        }
      })
    ]);

    const confirmedOrder = updatedOrder[0];
    
    // Notify Restaurant
    emitToRestaurant(confirmedOrder.restaurantId, 'NEW_ORDER', {
      orderId: confirmedOrder.id,
      message: `New order from ${req.user.name}`,
      order: confirmedOrder
    });

    // Notify Admin
    emitToAdmin('NEW_ORDER', {
      orderId: confirmedOrder.id,
      message: `New order placed at ${confirmedOrder.restaurant.name}`,
      order: confirmedOrder
    });

    res.json({
      message: 'Payment confirmed successfully',
      order: confirmedOrder,
      payment: updatedOrder[1]
    });

  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ 
      error: 'Failed to confirm payment',
      message: error.message 
    });
  }
});

/**
 * POST /payment/webhook
 * Stripe webhook endpoint for payment events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      
      try {
        // Update order and payment status
        await prisma.$transaction(async (tx) => {
          const order = await tx.order.findFirst({
            where: { paymentIntentId: paymentIntent.id }
          });

          if (order) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: 'SUCCEEDED',
                stripePaymentId: paymentIntent.id,
                paidAt: new Date()
              }
            });

            await tx.payment.update({
              where: { paymentIntentId: paymentIntent.id },
              data: {
                status: 'SUCCEEDED',
                stripePaymentId: paymentIntent.id,
                paymentMethod: paymentIntent.payment_method_types?.[0]
              }
            });
          }
        });

        console.log('✅ Payment succeeded:', paymentIntent.id);
        
        // Notify user and restaurant via socket if metadata exists
        const { orderId, restaurantId, userId } = paymentIntent.metadata;
        if (orderId) {
          sendToUser(userId, 'PAYMENT_SUCCEEDED', {
            orderId,
            message: 'Your payment was successful!'
          });
          
          if (restaurantId) {
            emitToRestaurant(restaurantId, 'NEW_ORDER', {
              orderId,
              message: 'New order received via webhook'
            });
          }
        }
      } catch (error) {
        console.error('Error updating payment status:', error);
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      
      try {
        await prisma.$transaction(async (tx) => {
          const order = await tx.order.findFirst({
            where: { paymentIntentId: paymentIntent.id }
          });

          if (order) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: 'FAILED'
              }
            });

            await tx.payment.update({
              where: { paymentIntentId: paymentIntent.id },
              data: {
                status: 'FAILED',
                failureReason: paymentIntent.last_payment_error?.message
              }
            });
          }
        });

        console.log('❌ Payment failed:', paymentIntent.id);
      } catch (error) {
        console.error('Error updating failed payment:', error);
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      const refund = charge.refunds?.data?.[0];
      
      try {
        if (charge.payment_intent) {
          await prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
              where: { paymentIntentId: charge.payment_intent }
            });

            if (order) {
              await tx.order.update({
                where: { id: order.id },
                data: {
                  refundStatus: 'COMPLETED'
                }
              });

              const payment = await tx.payment.findFirst({
                where: { paymentIntentId: charge.payment_intent }
              });

              if (payment) {
                await tx.payment.update({
                  where: { id: payment.id },
                  data: {
                    status: 'REFUNDED',
                    refundedAt: new Date()
                  }
                });
              }
            }
          });

          console.log('💰 Refund completed:', refund?.id);
        }
      } catch (error) {
        console.error('Error updating refund status:', error);
      }
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * GET /payment/status/:orderId
 * Get payment status for an order
 */
router.get('/status/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        paymentStatus: true,
        paymentIntentId: true,
        paidAt: true,
        payment: {
          select: {
            status: true,
            paymentMethod: true,
            failureReason: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);

  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

export default router;
