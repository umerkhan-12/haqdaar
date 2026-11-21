import { CallHandler, Injectable, NestInterceptor } from '@nestjs/common';
import { delay, type Observable } from 'rxjs';
import { env } from './env';

/** Real rails are not instant: add 50–300 ms per call (off in tests). */
@Injectable()
export class SimulatedLatency implements NestInterceptor {
  intercept(_: unknown, next: CallHandler): Observable<unknown> {
    if (env.NODE_ENV === 'test') return next.handle();
    return next.handle().pipe(delay(50 + Math.floor(Math.random() * 250)));
  }
}
