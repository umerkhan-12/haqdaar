import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { PrismaService } from './prisma.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ConsentsController } from './consents/consents.controller';
import { ConsentsService } from './consents/consents.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'identity',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    EventBusModule.forRoot({
      service: 'identity',
      busUrl: env.BUS_DATABASE_URL,
      outboxDatabaseUrl: env.IDENTITY_DATABASE_URL,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
  ],
  controllers: [AuthController, ConsentsController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, PrismaService, AuthService, ConsentsService],
})
export class AppModule {}
