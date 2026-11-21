import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'judge',
  title: 'Haqdaar Judge Mode',
  description:
    'One button per hackathon challenge. Each scenario drives the real public API through the gateway ' +
    'with demo accounts and returns step-by-step evidence. Available only when DEMO_MODE=1.',
});
