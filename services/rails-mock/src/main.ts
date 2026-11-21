import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'rails-mock',
  title: 'Haqdaar Rails (simulated)',
  description:
    'Simulated NADRA, Raast, household data and SMS with failure injection. SYNTHETIC DATA ONLY.',
});
