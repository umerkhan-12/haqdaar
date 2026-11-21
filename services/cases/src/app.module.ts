import { Module } from '@nestjs/common';
import { DemoResetController, DemoResetter, EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { CasesDemoReset } from './demo-reset';
import { env } from './env';
import { PrismaService } from './prisma.service';
import { Upstream } from './upstream';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { RulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
import { InternalController } from './internal.controller';
import { EventsConsumer } from './events.consumer';
import { EvalController } from './eval/eval.controller';
import { EvalService } from './eval/eval.service';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'cases',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    EventBusModule.forRoot({
      service: 'cases',
      busUrl: env.BUS_DATABASE_URL,
      outboxDatabaseUrl: env.CASES_DATABASE_URL,
    }),
  ],
  controllers: [CasesController, RulesController, EvalController, InternalController, DemoResetController],
  providers: [
    PrismaService,
    Upstream,
    RulesService,
    CasesService,
    EvalService,
    EventsConsumer,
    { provide: DemoResetter, useClass: CasesDemoReset },
  ],
})
export class AppModule {}
