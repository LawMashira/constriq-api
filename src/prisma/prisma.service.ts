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
  setDefaultResultOrder('ipv4first');
  const candidates = uniqueUrls([process.env.DATABASE_URL, process.env.DIRECT_URL]);
  if (candidates.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  logger.log(`Postgres sources: ${describeSources()}`);

  let lastError: unknown;
  for (const connectionString of candidates) {
    const pool = createPostgresPool(connectionString);
    try {
      const client = await pool.connect();
      try {
        await client.query('select 1');
      } finally {
        client.release();
      }
      logger.log(`Connected to Postgres at ${describeHost(connectionString)}`);
      return new PrismaService(pool);
    } catch (error) {
      lastError = error;
      logger.warn(`Could not reach ${describeHost(connectionString)} (${summarizeError(error)})`);
      await pool.end().catch(() => undefined);
    }
  }

  logger.error(
    `No reachable Postgres URL. Last error: ${summarizeError(lastError)}. ` +
      'Set DATABASE_URL to the Supabase transaction pooler (port 6543) and DIRECT_URL to the session pooler (port 5432).',
  );
  return new PrismaService(createPostgresPool(candidates[candidates.length - 1]));
}

export function createPostgresPool(connectionString: string) {
  const url = toPgUrl(connectionString);
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    max: 5,
  });
  pool.on('error', (error) => {
    logger.warn(`Idle Postgres client error: ${summarizeError(error)}`);
  });
  return pool;
}

function toPgUrl(connectionString: string) {
  const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
  if (!url.port) {
    url.port = '5432';
  }
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  // node-pg treats sslmode=require as full CA verification (P1011 on Railway → Supabase).
  url.searchParams.set('sslmode', 'no-verify');
  return url;
}

function uniqueUrls(raw: Array<string | undefined>) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of raw) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    urls.push(value);
  }
  return urls;
}

function describeSources() {
  return (
    ['DATABASE_URL', 'DIRECT_URL']
      .filter((name) => Boolean(process.env[name]))
      .map((name) => `${name}=${describeHost(process.env[name] ?? '')}`)
      .join(' ') || 'none'
  );
}

function describeHost(connectionString: string) {
  try {
    const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
    return `${url.hostname}:${url.port || 5432}`;
  } catch {
    return 'invalid-database-url';
  }
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split('\n')[0];
  }
  return 'unknown error';
}
