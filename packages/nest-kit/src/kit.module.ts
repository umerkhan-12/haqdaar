import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AuthGuard, RolesGuard } from './auth/guards';
import { AllExceptionsFilter } from './http/errors.filter';
import { HealthController, HealthRegistry } from './health';
import { KIT_OPTIONS, type KitOptions } from './kit.options';
import { ServiceClient } from './resilience/service-client';
import { EventBus, type EventBusOptions } from './events/event-bus';

/** Fields never written to logs. */
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'req.headers["x-api-key"]',
  '*.password',
  '*.pin',
  '*.cnic',
  '*.phone',
  '*.refreshToken',
  '*.accessToken',
];

/**
 * Everything a Haqdaar service needs: structured logs with request ids and PII redaction,
 * deny-by-default auth + roles guards, uniform errors, /health, and the ServiceClient.
 */
@Global()
@Module({})
export class KitModule {
  static forRoot(opts: KitOptions & { logLevel?: string; prettyLogs?: boolean }): DynamicModule {
    return {
      module: KitModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: opts.logLevel ?? 'info',
            name: opts.service,
            redact: { paths: REDACT, censor: '[redacted]' },
            genReqId: (req, res) => {
              const id = (req.headers['x-request-id'] as string) || randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            customProps: () => ({ service: opts.service }),
            autoLogging: { ignore: (req) => req.url === '/health' },
            transport: opts.prettyLogs
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          },
        }),
      ],
      controllers: [HealthController],
      providers: [
        { provide: KIT_OPTIONS, useValue: opts },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        HealthRegistry,
        ServiceClient,
      ],
      exports: [KIT_OPTIONS, HealthRegistry, ServiceClient],
    };
  }
}

/** Durable event bus (pg-boss) + optional outbox relay for services that own a schema. */
@Global()
@Module({})
export class EventBusModule {
  static forRoot(opts: EventBusOptions): DynamicModule {
    return {
      module: EventBusModule,
      providers: [{ provide: EventBus, useFactory: () => new EventBus(opts) }],
      exports: [EventBus],
    };
  }
}
