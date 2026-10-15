import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserStatus } from '@prisma/client';
import { Pool } from 'pg';
import {
  bootstrapCompanyIdentity,
  ensureGlobalPermissions,
} from '../src/identity/tenant-bootstrap';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL is required');
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  await ensureGlobalPermissions(prisma);

  const companies = await prisma.company.findMany({
    include: { users: true },
  });

  for (const company of companies) {
    const owner =
      company.users.find((user) => user.status === UserStatus.ACTIVE) ??
      company.users[0];
    if (!owner) {
      continue;
    }
    await prisma.$transaction((tx) =>
      bootstrapCompanyIdentity(tx, {
        companyId: company.id,
        userId: owner.id,
        ownerUserStatus: owner.status,
      }),
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
