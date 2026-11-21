import './env';
import { bootstrapService } from '@haqdaar/nest-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  service: 'payments',
  title: 'Haqdaar Payments',
  description:
    'Bank-grade payouts: state machine, idempotency, title fetch, velocity rules, maker-checker, status inquiry, double-entry ledger, reconciliation, signed webhooks.',
});
