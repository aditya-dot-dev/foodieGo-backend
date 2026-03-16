import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check completed orders
  const orders = await prisma.order.findMany({
    where: { status: 'COMPLETED' },
    select: {
      id: true,
      totalAmount: true,
      deliveryFee: true,
      restaurantId: true,
      deliveryPartnerId: true,
      restaurant: { select: { name: true } }
    }
  });

  console.log(`Found ${orders.length} completed orders\n`);
  
  orders.forEach(o => {
    const userPaid = o.totalAmount + (o.deliveryFee || 0);
    const restaurantShould = o.totalAmount * 0.80;
    const platformShould = o.totalAmount * 0.20;
    const deliveryShould = o.deliveryFee || 40;
    
    console.log(`Order: ${o.id.substring(0, 8)}...`);
    console.log(`  Restaurant: ${o.restaurant.name}`);
    console.log(`  User Paid: ₹${userPaid}`);
    console.log(`  Should distribute: Rest ₹${restaurantShould} + Platform ₹${platformShould} + Delivery ₹${deliveryShould}`);
  });

  // Check actual transactions
  console.log(`\n--- Actual Transactions ---\n`);
  
  const txns = await prisma.transaction.findMany({
    include: {
      wallet: {
        include: {
          restaurant: { select: { name: true } },
          user: { select: { name: true, role: true } }
        }
      }
    }
  });

  console.log(`Found ${txns.length} transactions\n`);
  
  txns.forEach(t => {
    const who = t.wallet.restaurant 
      ? t.wallet.restaurant.name
      : `${t.wallet.user?.name} (${t.wallet.user?.role})`;
    console.log(`₹${t.amount} → ${who}`);
    console.log(`  ${t.description}\n`);
  });

  //Check wallets
  console.log(`--- Wallet Balances ---\n`);
  
  const restWallets = await prisma.wallet.findMany({
    where: { restaurantId: { not: null } },
    include: { restaurant: true }
  });
  
  restWallets.forEach(w => {
    console.log(`${w.restaurant.name}: ₹${w.balance}`);
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
