import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Record Verification ---');
  
  const userCount = await prisma.user.count();
  const restaurantCount = await prisma.restaurant.count();
  const categoryCount = await prisma.menuCategory.count();
  const menuItemCount = await prisma.menuItem.count();
  const couponCount = await prisma.coupon.count();

  console.log(`Total Users: ${userCount}`);
  console.log(`Total Restaurants: ${restaurantCount}`);
  console.log(`Total Menu Categories: ${categoryCount}`);
  console.log(`Total Menu Items: ${menuItemCount}`);
  console.log(`Total Coupons: ${couponCount}`);

  const restaurants = await prisma.restaurant.findMany({
    include: { owner: true }
  });

  console.log('\n--- Restaurant Details ---');
  restaurants.forEach(res => {
    console.log(`- ${res.name} (${res.cuisine}) | Owner: ${res.owner.email}`);
  });

  const allPresent = restaurantCount >= 4;

  if (allPresent) {
    console.log('\nResult: Expanded restaurant data is PRESENT.');
  } else {
    console.log('\nResult: Some data might be missing.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
