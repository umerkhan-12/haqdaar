import { Module } from '@nestjs/common';
import { EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { PrismaService } from './prisma.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'audit',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    // Consumer only: no outbox of its own.
    EventBusModule.forRoot({ service: 'audit', busUrl: env.BUS_DATABASE_URL }),
  ],
  controllers: [AuditController],
  providers: [PrismaService, AuditService],
})
export class AppModule {}
