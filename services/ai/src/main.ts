import './env';
import multipart from '@fastify/multipart';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'ai',
  title: 'Haqdaar AI',
  description:
    'AI_PROFILE switch (dev / demo / offline), LLM + Urdu speech routing with fallback and circuit breakers, structured outputs, scam check, Kill AI.',
  configure: async (app) => {
    await app.register(multipart as never, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  },
});
