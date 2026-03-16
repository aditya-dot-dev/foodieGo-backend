import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Payment Distribution Audit ===\n');

  // Get all completed orders
  const completedOrders = await prisma.order.findMany({
    where: { status: 'COMPLETED' },
    include: {
      restaurant: { select: { name: true, id: true } },
      deliveryPartner: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`Total Completed Orders: ${completedOrders.length}\n`);

  console.log('--- Order Details ---');
  for (const order of completedOrders) {
    console.log(`\nOrder ID: ${order.id}`);
    console.log(`Restaurant: ${order.restaurant.name}`);
    console.log(`Food Total: ₹${order.totalAmount}`);
    console.log(`Delivery Fee: ₹${order.deliveryFee || 'N/A'}`);
    console.log(`Total Paid by User: ₹${order.totalAmount + (order.deliveryFee || 0)}`);
    console.log(`Delivery Partner: ${order.deliveryPartner?.name || 'None'}`);
    console.log(`Payment Status: ${order.paymentStatus}`);
    
    // Expected distribution
    const commission = order.totalAmount * 0.20;
    const restaurantEarning = order.totalAmount * 0.80;
    const deliveryFee = order.deliveryFee || 40;
    
    console.log(`Expected Distribution:`);
    console.log(`  Restaurant: ₹${restaurantEarning.toFixed(2)} (80% of food)`);
    console.log(`  Platform: ₹${commission.toFixed(2)} (20% of food)`);
    console.log(`  Delivery Partner: ₹${deliveryFee} (100% of delivery fee)`);
  }

  // Get all wallet transactions
  console.log('\n\n--- Wallet Transactions ---');
  
  const allTransactions = await prisma.transaction.findMany({
    include: {
      wallet: {
        include: {
          restaurant: { select: { name: true } },
          user: { select: { name: true, role: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\nTotal Transactions: ${allTransactions.length}\n`);

  for (const txn of allTransactions) {
    const owner = txn.wallet.restaurant 
      ? `Restaurant: ${txn.wallet.restaurant.name}`
      : `${txn.wallet.user?.role}: ${txn.wallet.user?.name}`;
    
    console.log(`${txn.type} - ₹${txn.amount} - ${owner}`);
    console.log(`  Description: ${txn.description}`);
    console.log(`  Date: ${txn.createdAt.toISOString()}`);
    console.log('');
  }

  // Get wallet balances
  console.log('\n--- Wallet Balances ---\n');
  
  const restaurantWallets = await prisma.wallet.findMany({
    where: { restaurantId: { not: null } },
    include: { restaurant: { select: { name: true } } }
  });

  console.log('Restaurant Wallets:');
  for (const wallet of restaurantWallets) {
    console.log(`  ${wallet.restaurant.name}: ₹${wallet.balance}`);
  }

  const deliveryWallets = await prisma.wallet.findMany({
    where: { 
      userId: { not: null },
      user: { role: 'DELIVERY_PARTNER' }
    },
    include: { user: { select: { name: true } } }
  });

  console.log('\nDelivery Partner Wallets:');
  for (const wallet of deliveryWallets) {
    console.log(`  ${wallet.user.name}: ₹${wallet.balance}`);
  }

  // Check for missing transactions
  console.log('\n\n=== AUDIT SUMMARY ===');
  console.log(`Completed Orders: ${completedOrders.length}`);
  console.log(`Total Transactions: ${allTransactions.length}`);
  console.log(`Expected Transactions: ${completedOrders.length * 2} (restaurant + delivery partner per order)`);
  
  if (allTransactions.length < completedOrders.length * 2) {
    console.log('⚠️  MISMATCH: Some transactions are missing!');
  } else {
    console.log('✅ Transaction count matches expected');
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
