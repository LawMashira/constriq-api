import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { setDefaultResultOrder } from 'node:dns';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = resolvePostgresUrl(
      process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    );
    preferRailwayPrivateDns(connectionString);
    super({
      adapter: new PrismaPg(createPgPool(connectionString), {
        disposeExternalPool: true,
      }),
    });
  }

  async onModuleInit() {
    const attempts = 8;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Database connect failed (${attempt}/${attempts}): ${message}`);
        if (attempt === attempts) {
          this.logger.error('Starting without a database connection; HTTP and CORS will still respond');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function preferRailwayPrivateDns(connectionString: string) {
  if (connectionString.includes('.railway.internal')) {
    setDefaultResultOrder('verbatim');
  }
}

function createPgPool(connectionString: string) {
  const url = new URL(connectionString.replace(/^postgres:/, 'postgresql:'));
  const internal = url.hostname.endsWith('.railway.internal');
  const sslMode = url.searchParams.get('sslmode');

  return new Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined,
    ssl: internal || sslMode === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}

function resolvePostgresUrl(raw?: string): string {
  if (!raw) {
    throw new Error('DATABASE_URL or DIRECT_URL is required');
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
