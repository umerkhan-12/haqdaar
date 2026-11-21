import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { SERVICES, type ServiceName } from '@haqdaar/shared';

export interface BootstrapOptions {
  service: ServiceName;
  title: string;
  description: string;
  port?: number;
  /** Called with the app before listen (register fastify plugins, CORS, etc.). */
  configure?: (app: NestFastifyApplication) => Promise<void> | void;
  bodyLimitBytes?: number;
}

/** Start a service: Fastify adapter, pino logger, graceful shutdown, Swagger at /docs. */
export async function bootstrapService(
  module: unknown,
  o: BootstrapOptions,
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: o.bodyLimitBytes ?? 1024 * 1024,
    // Keep one request id across gateway -> services -> logs -> error bodies.
    requestIdHeader: 'x-request-id',
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const id = randomUUID();
      req.headers['x-request-id'] = id;
      return id;
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(module as never, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (req, reply) => {
      reply.header('x-request-id', req.id);
    });

  if (o.configure) await o.configure(app);

  const doc = new DocumentBuilder()
    .setTitle(o.title)
    .setDescription(`${o.description}\n\nPROTOTYPE ONLY — not an official government service.`)
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-token' }, 'internal')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), {
    jsonDocumentUrl: 'docs/json',
  });

  const port = o.port ?? Number(process.env.PORT ?? SERVICES[o.service].port);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`${o.service} listening on :${port} (docs at /docs)`);
  return app;
}
