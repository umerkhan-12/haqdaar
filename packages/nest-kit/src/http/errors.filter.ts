import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { ErrorBody } from '@haqdaar/shared';

/**
 * One error format for every service: { statusCode, error, message, requestId, details? }.
 * Internal details (stack traces, SQL) never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId = (req.id ?? req.headers?.['x-request-id']) as string | undefined;

    const body = this.toBody(exception);
    body.requestId = requestId;

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId, url: req.url }, 'Unhandled error');
    }
    reply.status(body.statusCode).send(body);
  }

  private toBody(e: unknown): ErrorBody {
    if (e instanceof ZodError) {
      return {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const res = e.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : Array.isArray((res as { message?: unknown }).message)
            ? ((res as { message: string[] }).message.join('; '))
            : String((res as { message?: unknown }).message ?? e.message);
      const details = typeof res === 'object' ? (res as { details?: unknown }).details : undefined;
      return { statusCode: status, error: HttpStatus[status] ?? 'Error', message, details };
    }
    // Prisma known errors, matched by code so the kit does not depend on Prisma.
    const code = (e as { code?: string })?.code;
    if (code === 'P2002') return { statusCode: 409, error: 'Conflict', message: 'Already exists' };
    if (code === 'P2025') return { statusCode: 404, error: 'Not Found', message: 'Not found' };
    return { statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong' };
  }
}
