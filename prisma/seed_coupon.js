
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const coupon = await prisma.coupon.upsert({
    where: { code: 'WELCOME50' },
    update: {},
    create: {
      code: 'WELCOME50',
      description: 'Get 50% off on your first order',
      discountType: 'PERCENTAGE',
      discountAmount: 50,
      minOrderValue: 100,
      maxDiscount: 150,
      expiresAt: new Date('2026-12-31'),
      isActive: true
    }
  });
  console.log('Created coupon:', coupon);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
