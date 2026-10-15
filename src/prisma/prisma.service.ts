import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = resolvePostgresUrl(
      process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    );
    super({
      adapter: new PrismaPg(connectionString),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
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
