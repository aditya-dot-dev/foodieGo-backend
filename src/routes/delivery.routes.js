import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { mapPrismaError } from '../utils/prismaErrors.js';
import { sendToUser, emitToRestaurant, emitToAdmin } from '../config/socket.js';
const router = express.Router();

/**
 * GET /delivery/available-orders
 * Get all orders that are READY and not yet assigned to a delivery partner
 */
router.get('/available-orders', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: 'READY',
        deliveryPartnerId: null,
        // paymentStatus: 'SUCCEEDED' // Only show paid orders - DISABLED FOR TESTING
      },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true,
            address: true,
            area: true,
            city: true,
            lat: true,
            lng: true,
            phone: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                name: true,
                price: true,
                isVeg: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate total items for each order
    const ordersWithDetails = orders.map(order => ({
      ...order,
      totalItems: order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
    }));

    res.json(ordersWithDetails);
  } catch (error) {
    console.error('Available orders error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /delivery/my-orders
 * Get all orders assigned to the current delivery partner
 */
router.get('/my-orders', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        deliveryPartnerId: req.user.id
      },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true,
            address: true,
            area: true,
            city: true,
            lat: true,
            lng: true,
            phone: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                name: true,
                price: true,
                isVeg: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        address: true
      },
      orderBy: {
        assignedAt: 'desc'
      }
    });

    // Group orders by status
    const activeOrders = orders.filter(o => ['READY', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status));
    const completedOrders = orders.filter(o => o.status === 'COMPLETED');

    res.json({
      active: activeOrders,
      completed: completedOrders,
      all: orders
    });
  } catch (error) {
    console.error('Partner orders error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * POST /delivery/accept/:orderId
 * Accept an order for delivery
 */
router.post('/accept/:orderId', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const { orderId } = req.params;

    // Check if delivery partner is available
    const partner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isAvailable: true }
    });

    if (!partner?.isAvailable) {
      return res.status(400).json({ 
        error: 'You must be online to accept orders',
        message: 'Please toggle your availability to "Online" before accepting orders'
      });
    }

    // Check if order exists and is available
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        restaurant: {
          select: {
            name: true,
            address: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'READY') {
      return res.status(400).json({ 
        error: 'Order is not ready for pickup',
        message: `Order status is ${order.status}`
      });
    }

    if (order.deliveryPartnerId) {
      return res.status(400).json({ 
        error: 'Order already assigned',
        message: 'This order has been accepted by another delivery partner'
      });
    }

    // Assign order to delivery partner
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Create status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'READY', // Status stays READY until actually picked up
          changedBy: req.user.id
        }
      });

      // Update order with delivery partner
      return await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryPartnerId: req.user.id,
          assignedAt: new Date()
        },
        include: {
          restaurant: {
            select: {
              id: true,
              name: true,
              address: true,
              area: true,
              city: true,
              lat: true,
              lng: true,
            }
          },
          orderItems: {
            include: {
              menuItem: {
                select: {
                  name: true,
                  price: true,
                  isVeg: true
                }
              }
            }
          },
          user: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    // Notify user that a partner has accepted the order
    sendToUser(updatedOrder.userId, 'ORDER_ACCEPTED_BY_DELIVERY_PARTNER', {
      orderId: updatedOrder.id,
      message: 'A delivery partner is on the way to the restaurant',
      partnerName: req.user.name
    });

    // Notify Restaurant
    emitToRestaurant(updatedOrder.restaurantId, 'ORDER_ACCEPTED_BY_DELIVERY_PARTNER', {
      orderId: updatedOrder.id,
      message: 'Your order has been assigned to a delivery partner',
      partnerName: req.user.name
    });

    res.json({
      message: 'Order accepted successfully',
      order: updatedOrder
    });
  } catch (error) {
    console.error('Accept order error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /delivery/update-status/:orderId
 * Update the delivery status of an order
 */
router.patch('/update-status/:orderId', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate status
    const allowedStatuses = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'COMPLETED'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        message: `Status must be one of: ${allowedStatuses.join(', ')}`
      });
    }

    // Check if order exists and is assigned to this partner
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ 
        error: 'Unauthorized',
        message: 'You can only update status of your assigned orders'
      });
    }

    // Validate status transition
    const validTransitions = {
      'READY': ['PICKED_UP'],
      'PICKED_UP': ['OUT_FOR_DELIVERY'],
      'OUT_FOR_DELIVERY': ['COMPLETED']
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status transition',
        message: `Cannot change from ${order.status} to ${status}`
      });
    }

    // Update order status with timestamp
    const updateData = {
      status
    };

    if (status === 'PICKED_UP') {
      updateData.pickedUpAt = new Date();
    } else if (status === 'COMPLETED') {
      updateData.deliveredAt = new Date();
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Create status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: status,
          changedBy: req.user.id
        }
      });

      // Update order
      const updatedOrderResult = await tx.order.update({
        where: { id: orderId },
        data: updateData,
        include: {
          restaurant: {
            select: {
              id: true,
              name: true,
              address: true,
              area: true,
              city: true,
              lat: true,
              lng: true,
            }
          },
          orderItems: {
            include: {
              menuItem: {
                select: {
                  name: true,
                  price: true,
                  isVeg: true
                }
              }
            }
          },
          user: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });

      return updatedOrderResult;
    });

    // Notify User
    sendToUser(updatedOrder.userId, 'ORDER_STATUS_UPDATE', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      message: `Your order is ${status.toLowerCase().replace('_', ' ')}`,
      order: updatedOrder
    });

    // Also notify Restaurant
    emitToRestaurant(updatedOrder.restaurantId, 'ORDER_STATUS_UPDATE', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      message: `Order status updated to ${status.toLowerCase().replace('_', ' ')}`,
      order: updatedOrder
    });

    res.json({
      message: `Order status updated to ${status}`,
      order: updatedOrder
    });
  } catch (error) {
    console.error('Update delivery status error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /delivery/toggle-availability
 * Toggle delivery partner's online/offline status
 */
router.patch('/toggle-availability', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const partner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isAvailable: true }
    });

    const newAvailability = !partner.isAvailable;

    const updatedPartner = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        isAvailable: newAvailability
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isAvailable: true,
        vehicleType: true,
        vehicleNumber: true
      }
    });

    // Notify Admin about availability change
    emitToAdmin('PARTNER_STATUS_UPDATE', {
      partnerId: updatedPartner.id,
      isAvailable: updatedPartner.isAvailable,
      name: updatedPartner.name,
      message: `${updatedPartner.name} is now ${updatedPartner.isAvailable ? 'Online' : 'Offline'}`
    });

    res.json({
      message: newAvailability ? 'You are now online' : 'You are now offline',
      isAvailable: newAvailability,
      partner: updatedPartner
    });
  } catch (error) {
    console.error('Toggle availability error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /delivery/update-location
 * Update delivery partner's current location
 */
router.patch('/update-location', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ 
        error: 'Invalid coordinates',
        message: 'Latitude and longitude must be numbers'
      });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        currentLat: lat,
        currentLng: lng
      }
    });

    // Broadcast location to orders assigned to this partner
    const activeOrders = await prisma.order.findMany({
      where: {
        deliveryPartnerId: req.user.id,
        status: { in: ['PICKED_UP', 'OUT_FOR_DELIVERY'] }
      },
      select: { userId: true, id: true }
    });

    activeOrders.forEach(order => {
      sendToUser(order.userId, 'LOCATION_UPDATE', {
        orderId: order.id,
        lat,
        lng,
        partnerId: req.user.id
      });
    });

    res.json({
      message: 'Location updated successfully',
      lat,
      lng
    });
  } catch (error) {
    console.error('Update location error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /delivery/profile
 * Get delivery partner's profile
 */
router.get('/profile', authenticate, authorize('DELIVERY_PARTNER'), async (req, res) => {
  try {
    const partner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        vehicleType: true,
        vehicleNumber: true,
        isAvailable: true,
        currentLat: true,
        currentLng: true,
        createdAt: true
      }
    });

    // Get delivery stats
    const totalDeliveries = await prisma.order.count({
      where: {
        deliveryPartnerId: req.user.id,
        status: 'COMPLETED'
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayDeliveries = await prisma.order.count({
      where: {
        deliveryPartnerId: req.user.id,
        status: 'COMPLETED',
        deliveredAt: {
          gte: today
        }
      }
    });

    res.json({
      ...partner,
      stats: {
        totalDeliveries,
        todayDeliveries
      }
    });
  } catch (error) {
    console.error('Get partner profile error:', error);
    const { statusCode, message } = mapPrismaError(error);
    res.status(statusCode).json({ error: message });
  }
});

export default router;