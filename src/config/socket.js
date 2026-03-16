import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "http://localhost:8080",
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.token;
        
        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.user.id} (${socket.user.role})`);

        // Join personal room based on user ID
        socket.join(`user_${socket.user.id}`);

        // Handle joining specific restaurant rooms (for owners)
        socket.on('join_restaurant_room', (restaurantId) => {
            // In production, verify ownership here
            socket.join(`restaurant_${restaurantId}`);
            console.log(`Socket ${socket.id} joined restaurant room: ${restaurantId}`);
        });

        // If user is a delivery partner, join delivery room
        if (socket.user.role === 'DELIVERY_PARTNER') {
            socket.join('delivery_partners');
        }

        // If user is an admin, join admin room
        if (socket.user.role === 'ADMIN') {
            socket.join('admin_room');
            console.log(`Socket ${socket.id} joined admin_room`);
        }

        socket.on('join_order_room', (orderId) => {
            socket.join(`order_${orderId}`);
            console.log(`Socket ${socket.id} joined order room: ${orderId}`);
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.user.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

// Helper function to send notification to a specific user
export const sendToUser = (userId, event, data) => {
    if (io) {
        console.log(`📡 Emitting ${event} to user_${userId}`);
        io.to(`user_${userId}`).emit(event, data);
    } else {
        console.warn(`⚠️ Cannot emit ${event} to user_${userId}: Socket.io not initialized`);
    }
};

// Helper function to send notification to all delivery partners
export const broadcastToDeliveryPartners = (event, data) => {
    if (io) {
        console.log(`📡 Broadcasting ${event} to all delivery partners`);
        io.to('delivery_partners').emit(event, data);
    } else {
        console.warn(`⚠️ Cannot broadcast ${event}: Socket.io not initialized`);
    }
};

// Helper function to send notification to a specific restaurant room
export const emitToRestaurant = (restaurantId, event, data) => {
    if (io) {
        console.log(`📡 Emitting ${event} to restaurant_${restaurantId}`);
        io.to(`restaurant_${restaurantId}`).emit(event, data);
    } else {
        console.warn(`⚠️ Cannot emit ${event} to restaurant_${restaurantId}: Socket.io not initialized`);
    }
};

export const emitToAdmin = (event, data) => {
    if (io) {
        console.log(`📡 Emitting ${event} to admin_room`);
        io.to('admin_room').emit(event, data);
    } else {
        console.warn(`⚠️ Cannot emit ${event} to admin_room: Socket.io not initialized`);
    }
};
