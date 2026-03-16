import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🍽️ Adding more restaurants...');

  // 1. Find the existing owner
  const owner = await prisma.user.findUnique({
    where: { email: 'owner@test.com' },
  });

  if (!owner) {
    console.error('❌ Owner user (owner@test.com) not found. Please run seed.js first.');
    process.exit(1);
  }

  const restaurantsData = [
    {
      name: 'Wok & Roll',
      description: 'Authentic Chinese & Pan-Asian Delicacies',
      ownerId: owner.id,
      address: 'Sector 62, Noida',
      area: 'Noida Electronic City',
      city: 'Noida',
      lat: 28.6273,
      lng: 77.3725,
      cuisine: 'Chinese, Pan-Asian',
      deliveryTime: '25–35 mins',
      imageUrl: 'https://images.unsplash.com/photo-1552611052-33e04de081de?auto=format&fit=crop&w=800&q=80',
      priceRange: '₹500 for two',
      rating: 4.4,
      isVerified: true,
      categories: [
        {
          name: 'Dim Sums',
          items: [
            { name: 'Veg Crystal Dim Sum', price: 240, imageUrl: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c' },
            { name: 'Chicken Sui Mai', price: 280, imageUrl: 'https://images.unsplash.com/photo-1523905330026-b8bd1f5f320e' },
          ],
        },
        {
          name: 'Main Course',
          items: [
            { name: 'Kung Pao Chicken', price: 380, imageUrl: 'https://images.unsplash.com/photo-1525755662778-989d0524087e' },
            { name: 'Hakka Noodles', price: 220, imageUrl: 'https://images.unsplash.com/photo-1585032226651-759b368d7246' },
          ],
        },
      ],
    },
    {
      name: 'Pizza Paradise',
      description: 'Handcrafted Wood-fired Pizzas & Pastas',
      ownerId: owner.id,
      address: 'DLF Mall of India, Noida',
      area: 'Sector 18',
      city: 'Noida',
      lat: 28.5672,
      lng: 77.321,
      cuisine: 'Italian, Pizza',
      deliveryTime: '35–45 mins',
      imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80',
      priceRange: '₹800 for two',
      rating: 4.7,
      isVerified: true,
      categories: [
        {
          name: 'Pizzas',
          items: [
            { name: 'Margherita Pizza', price: 450, imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbad80ad38' },
            { name: 'Pepperoni Feast', price: 550, imageUrl: 'https://images.unsplash.com/photo-1628840042765-356cda07504e' },
          ],
        },
        {
          name: 'Pastas',
          items: [
            { name: 'Arrabiata Pasta', price: 320, imageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141' },
            { name: 'Alfredo Pasta', price: 350, imageUrl: 'https://images.unsplash.com/photo-1645112481338-35607b196144' },
          ],
        },
      ],
    },
    {
      name: 'The Sweet Spot',
      description: 'Heavenly Desserts, Cakes & Pastries',
      ownerId: owner.id,
      address: 'Alpha 2, Greater Noida',
      area: 'Commercial Belt',
      city: 'Greater Noida',
      lat: 28.467,
      lng: 77.514,
      cuisine: 'Desserts, Bakery',
      deliveryTime: '20–30 mins',
      imageUrl: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=800&q=80',
      priceRange: '₹400 for two',
      rating: 4.8,
      isVerified: true,
      categories: [
        {
          name: 'Cakes',
          items: [
            { name: 'Death by Chocolate', price: 150, imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587' },
            { name: 'Red Velvet Pastry', price: 120, imageUrl: 'https://images.unsplash.com/photo-1616031037011-087000171abe' },
          ],
        },
        {
          name: 'Shakes',
          items: [
            { name: 'Belgian Chocolate Shake', price: 180, imageUrl: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699' },
            { name: 'Oreo Shake', price: 160, imageUrl: 'https://images.unsplash.com/photo-1579954115545-a95591f28be0' },
          ],
        },
      ],
    },
  ];

  for (const res of restaurantsData) {
    const { categories, ...restDetails } = res;
    
    // Check if restaurant already exists to avoid duplicates
    const existingRes = await prisma.restaurant.findFirst({
      where: { name: res.name, ownerId: res.ownerId }
    });

    if (existingRes) {
      console.log(`✓ Restaurant ${res.name} already exists. Skipping.`);
      continue;
    }

    const createdRes = await prisma.restaurant.create({
      data: restDetails,
    });

    console.log(`✅ Created Restaurant: ${createdRes.name}`);

    for (const cat of categories) {
      const createdCat = await prisma.menuCategory.create({
        data: {
          name: cat.name,
          restaurantId: createdRes.id,
        },
      });

      console.log(`   📂 Created Category: ${createdCat.name}`);

      for (const item of cat.items) {
        await prisma.menuItem.create({
          data: {
            ...item,
            categoryId: createdCat.id,
          },
        });
        console.log(`      🍔 Created Item: ${item.name}`);
      }
    }
  }

  console.log('\n✨ Extra restaurants seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
