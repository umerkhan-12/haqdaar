import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@haqdaar/nest-kit';

export const STAFF = ['officer', 'admin', 'auditor'] as const;

export function isStaff(user: AuthUser): boolean {
  return (STAFF as readonly string[]).includes(user.role);
}

/** The person a citizen/helper session acts for. A helper must select a family (PIN) first. */
export function subjectPerson(user: AuthUser): string {
  if (!user.onBehalfOf) {
    throw new ForbiddenException(
      user.role === 'helper' ? 'Select a family first' : 'No person linked',
    );
  }
  return user.onBehalfOf;
}

export function requireUser(user: AuthUser | undefined): AuthUser {
  if (!user) throw new ForbiddenException('User token required');
  return user;
}
