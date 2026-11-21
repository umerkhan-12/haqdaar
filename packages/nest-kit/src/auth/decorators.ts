import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ApiScope, Role } from '@haqdaar/shared';

export const IS_PUBLIC = 'haqdaar:isPublic';
export const ROLES = 'haqdaar:roles';
export const INTERNAL_ONLY = 'haqdaar:internalOnly';

/** Route needs no token. Must be explicit — everything else is denied by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is allowed only for these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Route can only be called by another service with an internal token (never by a user). */
export const InternalOnly = () => SetMetadata(INTERNAL_ONLY, true);

export const SCOPE = 'haqdaar:scope';

/** Opens the route to partner (API key) tokens that carry this scope. Without it, partners get 403. */
export const PartnerScope = (scope: ApiScope) => SetMetadata(SCOPE, scope);

export interface AuthUser {
  kind: 'user';
  id: string;
  tenantId: string;
  role: Role;
  name: string;
  /** Helper Mode: acting on behalf of this person. */
  onBehalfOf?: string;
  /** Partner (API key) tokens: allowed scopes. */
  scopes?: string[];
}

export interface AuthService {
  kind: 'service';
  service: string;
}

export type Principal = AuthUser | AuthService;

/** Injects the authenticated principal (user or service). */
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().principal as Principal | undefined;
});

/** Injects the authenticated user. Throws at runtime if a service token was used. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const p = ctx.switchToHttp().getRequest().principal as Principal | undefined;
  return p?.kind === 'user' ? p : undefined;
});
