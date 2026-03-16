/*
  # Food Delivery App Database Schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key)
      - `name` (text)
      - `email` (text, unique)
      - `phone` (text)
      - `password` (text) - hashed password
      - `role` (text) - USER, RESTAURANT, or ADMIN
      - `createdAt` (timestamptz)

    - `restaurants`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text)
      - `isOpen` (boolean)
      - `ownerId` (uuid, foreign key to users)
      - `createdAt` (timestamptz)

    - `menu_categories`
      - `id` (uuid, primary key)
      - `name` (text)
      - `restaurantId` (uuid, foreign key to restaurants)

    - `menu_items`
      - `id` (uuid, primary key)
      - `name` (text)
      - `price` (numeric)
      - `isAvailable` (boolean)
      - `categoryId` (uuid, foreign key to menu_categories)

    - `orders`
      - `id` (uuid, primary key)
      - `userId` (uuid, foreign key to users)
      - `restaurantId` (uuid, foreign key to restaurants)
      - `status` (text) - PLACED, PREPARING, or DELIVERED
      - `totalAmount` (numeric)
      - `createdAt` (timestamptz)

    - `order_items`
      - `id` (uuid, primary key)
      - `orderId` (uuid, foreign key to orders)
      - `menuItemId` (uuid, foreign key to menu_items)
      - `quantity` (integer)
      - `price` (numeric)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Restaurant owners can manage their restaurants and menu items
    - Users can create orders and view their own orders
*/

-- Create custom types
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('USER', 'RESTAURANT', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('PLACED', 'PREPARING', 'DELIVERED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text NOT NULL,
  password text NOT NULL,
  role user_role DEFAULT 'USER' NOT NULL,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  "isOpen" boolean DEFAULT true NOT NULL,
  "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

-- Menu categories table
CREATE TABLE IF NOT EXISTS menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  "restaurantId" uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL,
  "isAvailable" boolean DEFAULT true NOT NULL,
  "categoryId" uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "restaurantId" uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  status order_status DEFAULT 'PLACED' NOT NULL,
  "totalAmount" numeric NOT NULL,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  "menuItemId" uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  price numeric NOT NULL
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Anyone can create user account"
  ON users FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policies for restaurants table
CREATE POLICY "Anyone can view open restaurants"
  ON restaurants FOR SELECT
  TO anon
  USING ("isOpen" = true);

CREATE POLICY "Restaurant owners can view their restaurants"
  ON restaurants FOR SELECT
  TO authenticated
  USING (auth.uid() = "ownerId");

CREATE POLICY "Authenticated users with RESTAURANT role can create restaurants"
  ON restaurants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = "ownerId");

CREATE POLICY "Restaurant owners can update their restaurants"
  ON restaurants FOR UPDATE
  TO authenticated
  USING (auth.uid() = "ownerId")
  WITH CHECK (auth.uid() = "ownerId");

-- RLS Policies for menu_categories
CREATE POLICY "Anyone can view menu categories"
  ON menu_categories FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Restaurant owners can manage menu categories"
  ON menu_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM restaurants
      WHERE restaurants.id = menu_categories."restaurantId"
      AND restaurants."ownerId" = auth.uid()
    )
  );

-- RLS Policies for menu_items
CREATE POLICY "Anyone can view available menu items"
  ON menu_items FOR SELECT
  TO anon
  USING ("isAvailable" = true);

CREATE POLICY "Restaurant owners can manage menu items"
  ON menu_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM menu_categories
      JOIN restaurants ON restaurants.id = menu_categories."restaurantId"
      WHERE menu_categories.id = menu_items."categoryId"
      AND restaurants."ownerId" = auth.uid()
    )
  );

-- RLS Policies for orders
CREATE POLICY "Users can view their own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (auth.uid() = "userId");

CREATE POLICY "Restaurant owners can view orders for their restaurants"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM restaurants
      WHERE restaurants.id = orders."restaurantId"
      AND restaurants."ownerId" = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = "userId");

-- RLS Policies for order_items
CREATE POLICY "Users can view order items for their orders"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items."orderId"
      AND orders."userId" = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners can view order items for their restaurants"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      JOIN restaurants ON restaurants.id = orders."restaurantId"
      WHERE orders.id = order_items."orderId"
      AND restaurants."ownerId" = auth.uid()
    )
  );

CREATE POLICY "Users can create order items when creating orders"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items."orderId"
      AND orders."userId" = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants("ownerId");
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories("restaurantId");
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items("categoryId");
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders("userId");
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders("restaurantId");
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items("orderId");
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON order_items("menuItemId");
