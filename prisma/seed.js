import prisma from '../src/config/database.js';
import bcrypt from 'bcryptjs';

async function main() {
  // clear old data (safe for dev)
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  // users
  const userPassword = await bcrypt.hash('user123', 10);
  const ownerPassword = await bcrypt.hash('owner123', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email: 'user@test.com',
      phone: '9000000001',
      password: userPassword,
      role: 'USER',
    },
  });

  const owner = await prisma.user.create({
    data: {
      name: 'Royal Owner',
      email: 'owner@test.com',
      phone: '9000000002',
      password: ownerPassword,
      role: 'RESTAURANT',
    },
  });

  // restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Royal Biryani House',
      description: 'Premium Mughlai & North Indian Cuisine',
      ownerId: owner.id,
      address: 'Sector 18, Noida',
      area: 'Industrial Area',
      city: 'Sas Nagar',
      lat: 30.699420087951776,
      lng: 76.69154511224673,
      cuisine: 'North Indian, Mughlai',
      deliveryTime: '30–40 mins',
      imageUrl:
        'https://images.unsplash.com/photo-1555992336-03a23c6a0d70?auto=format&fit=crop&w=800&q=80',
      priceRange: '₹600 for two',
      rating: 4.6,
      isVerified: true,
    },
  });

  // categories
  const categories = await prisma.menuCategory.createMany({
    data: [
      { name: 'Starters', restaurantId: restaurant.id },
      { name: 'Main Course', restaurantId: restaurant.id },
      { name: 'Breads', restaurantId: restaurant.id },
      { name: 'Beverages', restaurantId: restaurant.id },
    ],
  });

  const allCategories = await prisma.menuCategory.findMany({
    where: { restaurantId: restaurant.id },
  });

  const cat = Object.fromEntries(allCategories.map(c => [c.name, c.id]));

  // menu items
  await prisma.menuItem.createMany({
    data: [
      {
        name: 'Chicken Tikka',
        price: 280,
        imageUrl:
          'https://images.unsplash.com/photo-1604908177522-429bcd1d2c88',
        categoryId: cat['Starters'],
      },
      {
        name: 'Paneer Tikka',
        price: 260,
        imageUrl:
          'https://images.unsplash.com/photo-1628294896516-344152572ee8',
        categoryId: cat['Starters'],
      },
      {
        name: 'Chicken Biryani',
        price: 350,
        imageUrl:
          'https://images.unsplash.com/photo-1589302168068-964664d93dc0',
        categoryId: cat['Main Course'],
      },
      {
        name: 'Butter Naan',
        price: 60,
        imageUrl:
          'https://images.unsplash.com/photo-1601050690597-df0568f70950',
        categoryId: cat['Breads'],
      },
      {
        name: 'Masala Chaas',
        price: 70,
        imageUrl:
          'https://images.unsplash.com/photo-1604908177218-5d24b0f0e1d4',
        categoryId: cat['Beverages'],
      },
    ],
  });

  console.log('✅ Database seeded successfully');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
