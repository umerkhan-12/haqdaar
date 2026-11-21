import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@haqdaar/nest-kit';
import { SERVICES, serviceUrl, type ServiceName } from '@haqdaar/shared';

/** Services whose Swagger UI the gateway republishes (the gateway's own docs are already at /docs). */
export const DOCUMENTED = (Object.keys(SERVICES) as ServiceName[]).filter((s) => s !== 'gateway');

/** Public path of one service's API docs, relative to the gateway root (the web app adds `/api`). */
export const docsPath = (service: ServiceName): string => `/docs/${service}`;

/**
 * Swagger's page links its assets as `./docs/<file>`, which only resolves when the page lives at `/docs`.
 * Behind the gateway the page lives at `/docs/<service>` (or `/api/docs/<service>` through the web app), so the
 * links become `./<service>/<file>`: relative, therefore correct under any prefix.
 */
export function rewriteDocsHtml(html: string, service: string): string {
  return html.replaceAll('./docs/', `./${service}/`);
}

/**
 * "Try it out" must call the gateway, not the page's own folder: the spec gets one server computed in the browser
 * from the page address (everything before `/docs/<service>`), so it works on :4000 and under the web app's `/api`.
 */
export function rewriteDocsInit(js: string): string {
  return js.replace(
    '"servers": []',
    '"servers": [{ "url": window.location.origin + window.location.pathname.split("/docs/")[0], "description": "Haqdaar gateway" }]',
  );
}

/**
 * API docs of every service through the single public entry, so they are reachable on a deployed site where the
 * service ports are private. No auth: the docs are public reading, the API itself still needs a token or API key.
 */
@ApiExcludeController()
@Controller('docs')
export class DocsController {
  @Public()
  @Get(':service')
  page(@Param('service') service: string, @Res() reply: FastifyReply) {
    return this.forward(service, '', reply);
  }

  @Public()
  @Get(':service/*')
  asset(@Param('service') service: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const rest = (req.params as { '*'?: string })['*'] ?? '';
    return this.forward(service, rest, reply);
  }

  private async forward(service: string, rest: string, reply: FastifyReply): Promise<void> {
    if (!(DOCUMENTED as string[]).includes(service) || rest.includes('..')) {
      throw new NotFoundException('No such API docs');
    }
    let res: Response;
    try {
      // No trailing slash for the page itself: Swagger emits different asset links for `/docs/`.
      const path = rest ? `/docs/${rest}` : '/docs';
      res = await fetch(`${serviceUrl(service as ServiceName)}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException(
        `The ${service} service is temporarily unavailable. Please try again.`,
      );
    }
    if (!res.ok) throw new NotFoundException('No such API docs');

    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    // The page and its generated init script change with every deploy; only the static bundle is cached.
    const generated =
      rest === '' || rest === 'swagger-ui-init.js' || rest === 'json' || rest === 'yaml';
    reply
      .header('content-type', type)
      .header('cache-control', generated ? 'no-cache' : 'public, max-age=3600');
    if (rest === '') {
      void reply.send(rewriteDocsHtml(await res.text(), service));
    } else if (rest === 'swagger-ui-init.js') {
      void reply.send(rewriteDocsInit(await res.text()));
    } else {
      void reply.send(Buffer.from(await res.arrayBuffer()));
    }
  }
}
