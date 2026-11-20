import { Module } from '@nestjs/common';
import { EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'ai',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    // Stateless service: publishes directly (no outbox table of its own).
    EventBusModule.forRoot({ service: 'ai', busUrl: env.BUS_DATABASE_URL }),
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AppModule {}
