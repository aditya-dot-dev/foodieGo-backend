import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Creating Super Admin ---');

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@swiggy.com' }
  });

  if (existingAdmin) {
    console.log('❌ Admin user already exists!');
    console.log(`Email: ${existingAdmin.email}`);
    console.log(`Role: ${existingAdmin.role}`);
    return;
  }

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@swiggy.com',
      phone: '9999999999',
      password: adminPassword,
      role: 'ADMIN',
      isVerified: true,
    },
  });

  console.log('✅ Super Admin created successfully!');
  console.log('\n--- Login Credentials ---');
  console.log(`Email: admin@swiggy.com`);
  console.log(`Password: admin123`);
  console.log(`Role: ADMIN`);
  console.log(`\nYou can now access the admin dashboard at /admin`);
}

main()
  .catch((e) => {
    console.error('Error creating admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
