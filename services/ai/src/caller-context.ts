import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Principal } from '@haqdaar/nest-kit';
import { Observable } from 'rxjs';

/** Who triggered the AI call in progress, so usage events carry the caller's tenant without threading it through every task. */
export const callerContext = new AsyncLocalStorage<Principal>();

@Injectable()
export class CallerContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = ctx.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    if (!principal) return next.handle();
    // The handler runs when the stream is subscribed, so subscribe inside the context.
    return new Observable((sub) =>
      callerContext.run(principal, () => next.handle().subscribe(sub)),
    );
  }
}
