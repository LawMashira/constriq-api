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
  const candidates = uniqueUrls([
    process.env.DATABASE_PUBLIC_URL,
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
  ]);
  if (candidates.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  let lastError: unknown;
  for (const connectionString of candidates) {
    preferRailwayDns(connectionString);
    const pool = createPgPool(connectionString);
    try {
      await pool.query('select 1');
      logger.log(`Connected to Postgres at ${describeHost(connectionString)}`);
      return new PrismaService(pool);
    } catch (error) {
      lastError = error;
      logger.warn(
        `Could not reach ${describeHost(connectionString)} (${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'})`,
      );
      await pool.end().catch(() => undefined);
    }
  }

  const fallback = candidates[candidates.length - 1];
  logger.error(
    `No reachable Postgres URL. Last error: ${lastError instanceof Error ? lastError.message.split('\n')[0] : 'unknown'}. ` +
      (candidates.every((url) => url.includes('.railway.internal'))
        ? 'Set DATABASE_PUBLIC_URL on constriq-api to the Postgres TCP proxy URL (*.proxy.rlwy.net).'
        : 'Check DATABASE_URL / DATABASE_PUBLIC_URL.'),
  );
  return new PrismaService(createPgPool(fallback));
}

function uniqueUrls(raw: Array<string | undefined>) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of raw) {
    const resolved = resolvePostgresUrl(value);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    urls.push(resolved);
  }
  return urls;
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

  return new Pool({
    connectionString: url.toString(),
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
