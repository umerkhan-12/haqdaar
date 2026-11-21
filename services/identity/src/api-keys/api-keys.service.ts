import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomToken, sha256, signAccessToken, type AuthUser } from '@haqdaar/nest-kit';
import type { ApiScope, TokenPair } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import { env } from '../env';

const PREFIX = 'hq_live_';
/** Partner tokens are short-lived and have no refresh token: re-exchange the key instead. */
const PARTNER_TOKEN_TTL_SECONDS = 900;

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** The full key is returned ONCE. Only its SHA-256 hash is stored. */
  async create(admin: AuthUser, name: string, scopes: ApiScope[]) {
    const key = `${PREFIX}${randomToken(24)}`;
    const row = await this.prisma.apiKey.create({
      data: {
        tenantId: admin.tenantId,
        name,
        prefix: key.slice(0, PREFIX.length + 6),
        keyHash: sha256(key),
        scopes,
      },
    });
    return { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, key, note: 'Shown once. Store it securely.' };
  }

  list(admin: AuthUser) {
    return this.prisma.apiKey.findMany({
      where: { tenantId: admin.tenantId },
      select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(admin: AuthUser, id: string) {
    const r = await this.prisma.apiKey.updateMany({
      where: { id, tenantId: admin.tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw new NotFoundException('Active API key not found');
  }

  /** Client-credentials exchange: API key → 15-minute partner token limited to the key's scopes. */
  async exchange(apiKey: string): Promise<Omit<TokenPair, 'refreshToken'>> {
    const row = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(apiKey) } });
    if (!row || row.revokedAt) throw new UnauthorizedException('Invalid API key');
    await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    const accessToken = signAccessToken(
      { sub: `apikey:${row.id}`, tid: row.tenantId, role: 'partner', name: row.name, scp: row.scopes },
      env.JWT_PRIVATE_KEY,
      PARTNER_TOKEN_TTL_SECONDS,
    );
    return { accessToken, expiresIn: PARTNER_TOKEN_TTL_SECONDS };
  }
}
