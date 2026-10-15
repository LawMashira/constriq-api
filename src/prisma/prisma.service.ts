import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { setDefaultResultOrder } from 'node:dns';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(pool: Pool) {
    super({
      adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

const logger = new Logger('PrismaService');

export async function createPrismaService() {
  const connectionString = resolvePostgresUrl(process.env.DATABASE_URL ?? process.env.DIRECT_URL);
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  preferRailwayDns(connectionString);
  const pool = createPgPool(connectionString);
  try {
    await pool.query('select 1');
    logger.log(`Connected to Postgres at ${describeHost(connectionString)}`);
    return new PrismaService(pool);
  } catch (error) {
    const host = describeHost(connectionString);
    logger.error(
      `DATABASE_URL host ${host} is unreachable (${error instanceof Error ? error.message : 'unknown error'}). ` +
        (host.includes('.railway.internal')
          ? 'postgres.railway.internal is private to Railway. On the Postgres service open Connect / TCP Proxy, copy the public URL, and set that as DATABASE_URL on constriq-api.'
          : 'Check DATABASE_URL, SSL, and that the database is running.'),
    );
    return new PrismaService(pool);
  }
}

function preferRailwayDns(connectionString: string) {
  if (connectionString.includes('.railway.internal')) {
    setDefaultResultOrder('ipv6first');
  }
}

function createPgPool(connectionString: string) {
  const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
  if (!url.port) {
    url.port = '5432';
  }
  const internal = url.hostname.endsWith('.railway.internal');
  const sslMode = url.searchParams.get('sslmode');
  const normalized = url.toString();

  return new Pool({
    connectionString: normalized,
    ssl: internal || sslMode === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}

function describeHost(connectionString: string) {
  try {
    const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
    return `${url.hostname}:${url.port || 5432}`;
  } catch {
    return 'invalid-database-url';
  }
}

function resolvePostgresUrl(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('postgres://') || raw.startsWith('postgresql://')) {
    return raw;
  }
  if (raw.startsWith('prisma+postgres://')) {
    const apiKey = new URL(raw).searchParams.get('api_key');
    if (apiKey) {
      const payload = JSON.parse(
        Buffer.from(apiKey.split('.')[1], 'base64url').toString('utf8'),
      ) as { databaseUrl?: string };
      if (payload.databaseUrl) {
        return payload.databaseUrl;
      }
    }
  }
  return raw;
}
