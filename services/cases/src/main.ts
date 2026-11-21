import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'cases',
  title: 'Haqdaar Cases',
  description:
    'Claims lifecycle, versioned JSON Logic rules, cost-based decision engine (never auto-rejects), officer queue, Digital Twin.',
});
