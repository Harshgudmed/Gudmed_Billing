import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function run() {
  console.log('Running fast bulk update...');
  const count = await db.$executeRawUnsafe(`UPDATE "PharmacyDrug" SET "quantityInStock" = floor(random() * 450 + 50)::int WHERE "organizationId" = 'org-demo' AND "isActive" = true`);
  console.log('Updated ' + count + ' drugs instantly.');
  process.exit(0);
}

run().catch(console.error);
