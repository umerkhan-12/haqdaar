import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthRegistry } from '@haqdaar/nest-kit';
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly health: HealthRegistry) { super(); }
  async onModuleInit() {
    await this.$connect();
    this.health.register('database', async () => { await this.$queryRaw`SELECT 1`; });
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
