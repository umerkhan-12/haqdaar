import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';
import { configureEdge } from './proxy';

void bootstrapService(AppModule, {
  service: 'gateway',
  title: 'Haqdaar Gateway',
  description:
    'Single public entry. Routes by path prefix to identity, cases, ai, payments, audit and rails-mock. ' +
    'Security headers, CORS allowlist, rate limiting, request ids. Each service has its own /docs.',
  configure: configureEdge,
  bodyLimitBytes: 6 * 1024 * 1024, // audio uploads pass through to the ai service
});
