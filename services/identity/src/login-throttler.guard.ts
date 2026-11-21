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
    const ip: string = req.ips?.[0] ?? req.ip;
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '').slice(-10) : '';
    return phone ? `${ip}:${phone}` : ip;
  }
}
