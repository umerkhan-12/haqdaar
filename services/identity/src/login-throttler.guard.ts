import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit key = client IP + phone. Behind the gateway many people share one public IP
 * (a venue, a village shop), so an IP-only key would lock out everyone at once.
 * Per-account lockout after repeated failures is the second layer (AuthService).
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    // req.ips[0] is the closest hop (the gateway itself), which would make one limit for everybody.
    // With trustProxy, req.ip is the furthest address: the visitor the gateway put in X-Forwarded-For.
    const ip: string = req.ip ?? req.ips?.at(-1);
    const phone =
      typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '').slice(-10) : '';
    return phone ? `${ip}:${phone}` : ip;
  }
}
