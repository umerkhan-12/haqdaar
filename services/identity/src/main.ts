import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'identity',
  title: 'Haqdaar Identity',
  description: 'Tenants, users, RS256 tokens with refresh rotation, consent, API keys.',
});
