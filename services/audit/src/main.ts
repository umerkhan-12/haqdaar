import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'audit',
  title: 'Haqdaar Audit',
  description: 'Append-only, hash-chained log of every event in the system, with chain verification.',
});
