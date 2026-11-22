import { Module, OnModuleInit } from '@nestjs/common';
import { DemoResetController, DemoResetter, HealthRegistry, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { buildSeed } from './data/seed-data';
import { RailsStore } from './rails.store';
import { fileJournal } from './journal';
import {
  FaultsController,
  NadraController,
  RaastController,
  SmsController,
} from './rails.controller';

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
  controllers: [
    NadraController,
    RaastController,
    SmsController,
    FaultsController,
    DemoResetController,
  ],
  providers: [
    {
      provide: RailsStore,
      useFactory: () =>
        new RailsStore(
          buildSeed(),
          undefined,
          process.env.RAILS_STATE_FILE ? fileJournal(process.env.RAILS_STATE_FILE) : undefined,
        ),
    },
    {
      provide: DemoResetter,
      useFactory: (rails: RailsStore) => ({ reset: async () => rails.resetActivity() }),
      inject: [RailsStore],
    },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly rails: RailsStore,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register('store', async () => ({
      ...this.rails.counts,
      faults: this.rails.getFaults(),
    }));
  }
}
