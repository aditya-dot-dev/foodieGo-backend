# Food Delivery Backend API

A production-ready backend service for a Swiggy-like food delivery application built with Node.js, Express, PostgreSQL (Supabase), and Prisma ORM.

## Features

- JWT-based authentication with bcrypt password hashing
- Role-based access control (USER, RESTAURANT, ADMIN)
- RESTful API endpoints
- PostgreSQL database with Prisma ORM
- CORS enabled for external frontend
- Production-ready error handling

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma
- **Authentication**: JWT + bcrypt
- **CORS**: Enabled for http://localhost:3000

## Database Schema

### Models

- **User**: id, name, email, phone, password, role, createdAt
- **Restaurant**: id, name, description, isOpen, ownerId, createdAt
- **MenuCategory**: id, name, restaurantId
- **MenuItem**: id, name, price, isAvailable, categoryId
- **Order**: id, userId, restaurantId, status, totalAmount, createdAt
- **OrderItem**: id, orderId, menuItemId, quantity, price

## API Endpoints

### Authentication

```
POST   /auth/register    - Register a new user
POST   /auth/login       - Login user
POST   /auth/logout      - Logout user (requires auth)
```

### Restaurants

```
GET    /restaurants         - Get all open restaurants
GET    /restaurants/:id     - Get restaurant by ID with menu
POST   /restaurants         - Create restaurant (RESTAURANT role required)
```

### Menu

```
GET    /restaurants/:id/menu - Get restaurant menu
```

### Orders

```
POST   /orders      - Create new order (requires auth)
GET    /orders/my   - Get user's orders (requires auth)
```

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- A Supabase account (free tier works)

### Installation

1. **Clone and install dependencies**

```bash
npm install
```

2. **Environment Configuration**

The `.env` file is already configured with your Supabase connection. The variables include:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens (change in production!)
- `PORT` - Server port (default: 4000)
- `NODE_ENV` - Environment mode

3. **Generate Prisma Client**

```bash
npm run prisma:generate
```

4. **Database Setup**

The database schema has already been applied to Supabase. All tables and relationships are ready to use.

## Running the Application

### Development Mode

```bash
npm run dev
```

The server will start on `http://localhost:4000` with auto-reload enabled.

### Production Mode

```bash
npm start
```

### Health Check

Visit `http://localhost:4000/health` to verify the server is running.

## API Usage Examples

### Register a User

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "password": "securepass123",
    "role": "USER"
  }'
```

### Login

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securepass123"
  }'
```

### Create Restaurant (RESTAURANT role)

```bash
curl -X POST http://localhost:4000/restaurants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Pizza Palace",
    "description": "Best pizzas in town",
    "isOpen": true
  }'
```

### Get All Restaurants

```bash
curl http://localhost:4000/restaurants
```

### Create Order

```bash
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "restaurantId": "restaurant-uuid",
    "items": [
      {
        "menuItemId": "item-uuid",
        "quantity": 2
      }
    ]
  }'
```

### Get My Orders

```bash
curl http://localhost:4000/orders/my \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Authentication Flow

1. Register or login to receive a JWT token
2. Include the token in the `Authorization` header as `Bearer <token>`
3. Protected routes will validate the token and extract user information

## Role-Based Access

- **USER**: Can view restaurants, place orders, view their own orders
- **RESTAURANT**: Can create and manage restaurants, plus all USER permissions
- **ADMIN**: Full access to all endpoints

## CORS Configuration

The API allows requests from `http://localhost:3000` with credentials enabled. To modify this, update the CORS configuration in `src/server.js`.

## Project Structure

```
.
├── src/
│   ├── config/
│   │   └── database.js           # Prisma client configuration
│   ├── middleware/
│   │   └── auth.middleware.js    # Authentication & authorization
│   ├── routes/
│   │   ├── auth.routes.js        # Auth endpoints
│   │   ├── restaurant.routes.js  # Restaurant endpoints
│   │   ├── menu.routes.js        # Menu endpoints
│   │   └── order.routes.js       # Order endpoints
│   ├── utils/
│   │   └── jwt.utils.js          # JWT token generation
│   └── server.js                 # Express app configuration
├── prisma/
│   └── schema.prisma             # Database schema
├── .env                          # Environment variables
├── .env.example                  # Example environment variables
├── package.json
└── README.md
```

## Security Notes

- Always change the `JWT_SECRET` in production
- Password are hashed using bcrypt with 10 salt rounds
- JWT tokens expire after 7 days
- All sensitive routes are protected with authentication middleware
- Row Level Security (RLS) is enabled on all database tables

## Free Tier Optimizations

- Minimal dependencies to reduce bundle size
- Efficient database queries with Prisma
- Supabase free tier includes:
  - 500 MB database space
  - 2 GB file storage
  - 50 MB database file storage

## Next Steps

To connect this backend with a Next.js frontend:

1. Use the API base URL: `http://localhost:4000`
2. Store JWT tokens in localStorage or cookies
3. Include the token in all authenticated requests
4. Handle 401/403 errors for authentication/authorization failures

## License

ISC
