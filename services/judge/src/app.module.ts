import { Module } from '@nestjs/common';
import { EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { JudgeController } from './judge.controller';
import { JudgeService } from './judge.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'judge',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    EventBusModule.forRoot({ service: 'judge', busUrl: env.BUS_DATABASE_URL }),
  ],
  controllers: [JudgeController],
  providers: [JudgeService],
})
export class AppModule {}
