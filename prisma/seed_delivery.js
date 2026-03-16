import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🚴 Seeding delivery partners...');

  // Create delivery partners
  const deliveryPartners = [
    {
      name: 'Rajesh Kumar',
      email: 'rajesh.delivery@foodiego.com',
      phone: '9876543210',
      vehicleType: 'bike',
      vehicleNumber: 'MH12AB1234',
      currentLat: 12.9716,
      currentLng: 77.5946,
    },
    {
      name: 'Amit Singh',
      email: 'amit.delivery@foodiego.com',
      phone: '9876543211',
      vehicleType: 'scooter',
      vehicleNumber: 'MH12CD5678',
      currentLat: 12.9352,
      currentLng: 77.6245,
    },
    {
      name: 'Priya Sharma',
      email: 'priya.delivery@foodiego.com',
      phone: '9876543212',
      vehicleType: 'bicycle',
      vehicleNumber: 'MH12EF9012',
      currentLat: 12.9279,
      currentLng: 77.6271,
    },
  ];

  const hashedPassword = await bcrypt.hash('password123', 10);

  for (const partner of deliveryPartners) {
    const existingPartner = await prisma.user.findUnique({
      where: { email: partner.email },
    });

    if (existingPartner) {
      console.log(`✓ Delivery partner ${partner.name} already exists`);
      // Update to ensure they're available
      await prisma.user.update({
        where: { email: partner.email },
        data: {
          isAvailable: false,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          ...partner,
          password: hashedPassword,
          role: 'DELIVERY_PARTNER',
          isAvailable: false, // Set as available
        },
      });
      console.log(`✓ Created delivery partner: ${partner.name}`);
    }
  }

  console.log('');
  console.log('✅ Delivery partners seeded successfully!');
  console.log('');
  console.log('📋 Delivery Partner Accounts:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  deliveryPartners.forEach((partner) => {
    console.log(`   Email: ${partner.email}`);
    console.log(`   Password: password123`);
    console.log(`   Vehicle: ${partner.vehicleType} (${partner.vehicleNumber})`);
    console.log(`   Status: Online`);
    console.log('   ─────────────────────────────────────────────');
  });
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });