import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@haqdaar/shared';
import { INTERNAL_ONLY, IS_PUBLIC, ROLES, SCOPE, type Principal } from './decorators';
import { verifyAccessToken, verifyInternalToken } from './tokens';
import { KIT_OPTIONS, type KitOptions } from '../kit.options';

export const INTERNAL_HEADER = 'x-internal-token';

/**
 * Global guard, deny by default:
 *  - `@Public()` routes pass without a token
 *  - `x-internal-token` header → service principal (only accepted by this service's audience)
 *  - `Authorization: Bearer` → user principal (RS256, verified locally with the public key)
 *  - `@InternalOnly()` routes reject user tokens
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(KIT_OPTIONS) private readonly opts: KitOptions,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const internalOnly = this.reflector.getAllAndOverride<boolean>(INTERNAL_ONLY, targets);

    const internal = req.headers[INTERNAL_HEADER] as string | undefined;
    if (internal) {
      try {
        const { service } = verifyInternalToken(
          internal,
          this.opts.service,
          this.opts.internalSecret,
        );
        req.principal = { kind: 'service', service } satisfies Principal;
        return true;
      } catch {
        throw new UnauthorizedException('Invalid internal token');
      }
    }

    if (internalOnly) throw new ForbiddenException('Internal route');

    const header = req.headers.authorization as string | undefined;
    if (header?.startsWith('Bearer ')) {
      try {
        const c = verifyAccessToken(header.slice(7), this.opts.jwtPublicKey);
        req.principal = {
          kind: 'user',
          id: c.sub,
          tenantId: c.tid,
          role: c.role,
          name: c.name,
          onBehalfOf: c.obo,
          scopes: c.scp,
        } satisfies Principal;
        return true;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Invalid or expired token');
      }
    }

    if (isPublic) return true;
    throw new UnauthorizedException('Missing token');
  }
}

/**
 * Checks `@Roles(...)`. Services always pass; their routes are guarded by `@InternalOnly`.
 * Partner (API key) tokens are denied everywhere unless the route declares `@PartnerScope(x)`
 * and the token carries scope x.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const p = ctx.switchToHttp().getRequest().principal as Principal | undefined;

    if (p?.kind === 'user' && p.role === 'partner') {
      const scope = this.reflector.getAllAndOverride<string | undefined>(SCOPE, targets);
      if (!scope || !p.scopes?.includes(scope)) {
        throw new ForbiddenException(
          scope ? `API key lacks scope: ${scope}` : 'Not available to API keys',
        );
      }
      return true;
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (!roles?.length) return true;
    if (!p) throw new UnauthorizedException();
    if (p.kind === 'service') return true;
    if (!roles.includes(p.role))
      throw new ForbiddenException(`Requires role: ${roles.join(' | ')}`);
    return true;
  }
}
