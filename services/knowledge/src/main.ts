import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'knowledge',
  title: 'Haqdaar Knowledge',
  description: 'Policy-document retrieval with citations and safe refusals.',
});
