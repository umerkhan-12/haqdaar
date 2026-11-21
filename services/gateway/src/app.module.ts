import { Module } from '@nestjs/common';
import { KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { StatusController } from './status.controller';
import { UsageMeter } from './usage-meter';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'gateway',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
  ],
  controllers: [StatusController],
  providers: [UsageMeter],
})
export class AppModule {}
