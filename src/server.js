import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import restaurantRoutes from './routes/restaurant.routes.js';
import menuRoutes from './routes/menu.routes.js';
import orderRoutes from './routes/order.routes.js';
import profileRoutes from './routes/profile.routes.js';
import addressRoutes from './routes/address.routes.js';
import searchRoutes from './routes/search.routes.js';
import couponRoutes from './routes/coupon.routes.js';
import favoriteRoutes from './routes/favorite.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import adminRoutes from './routes/admin.routes.js';

import financeRoutes from './routes/finance.routes.js';
import { mapPrismaError } from './utils/prismaErrors.js';

import { createServer } from 'http';
import { initSocket } from './config/socket.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// Initialize Socket.io
initSocket(httpServer);

// Middleware
app.use(cors({
  origin: [
    "http://localhost:8080",
    "https://foodie-go-frontend.vercel.app"
  ],
  credentials: true
}));

// Stripe webhook needs raw body, so we add it before express.json()
app.use('/payment/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Food Delivery API is running' });
});

app.use('/auth', authRoutes);
app.use('/restaurants', restaurantRoutes);
app.use('/restaurants', menuRoutes);
app.use('/orders', orderRoutes);
app.use('/profile', profileRoutes);
app.use('/addresses', addressRoutes);
app.use('/menu', searchRoutes);
app.use('/coupons', couponRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/payment', paymentRoutes);
app.use('/delivery', deliveryRoutes);
app.use('/admin', adminRoutes);
app.use('/finance', financeRoutes);

app.use((err, req, res, next) => {
  // Handle Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large. Max size is 5MB.' });
  }
  if (err.message === 'Only image files are allowed!') {
    return res.status(400).json({ error: err.message });
  }

  // Handle Prisma errors that weren't caught locally
  if (err.code && err.code.startsWith('P')) {
    const { statusCode, message } = mapPrismaError(err);
    return res.status(statusCode).json({ error: message });
  }

  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
