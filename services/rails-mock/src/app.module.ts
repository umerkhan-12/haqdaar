import { Module, OnModuleInit } from '@nestjs/common';
import { HealthRegistry, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { buildSeed } from './data/seed-data';
import { RailsStore } from './rails.store';
import { FaultsController, NadraController, RaastController, SmsController } from './rails.controller';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'rails-mock',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
  ],
  controllers: [NadraController, RaastController, SmsController, FaultsController],
  providers: [{ provide: RailsStore, useFactory: () => new RailsStore(buildSeed()) }],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly rails: RailsStore,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register('store', async () => ({ ...this.rails.counts, faults: this.rails.getFaults() }));
  }
}
