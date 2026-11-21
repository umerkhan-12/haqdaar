import { HttpException, Injectable } from '@nestjs/common';
import { ServiceClient } from '@haqdaar/nest-kit';
import type { ConsentPurpose } from '@haqdaar/shared';

export interface NadraRecord {
  cnic: string;
  fullName: string;
  guardianName: string;
  dateOfBirth: string;
  gender: string;
  district: string;
  maritalStatus: string;
  deceased: boolean;
}

export interface NadraVerifyResponse {
  match: boolean;
  nameScore: number | null;
  record: NadraRecord | null;
}

export interface HouseholdRecord {
  cnic: string;
  householdSize: number;
  monthlyIncomePkr: number;
  district: string;
  pmtScore: number;
  ownsVehicle: boolean;
}

/** Typed calls to identity and rails-mock (contracts in docs/CONTRACTS.md). */
@Injectable()
export class Upstream {
  constructor(private readonly client: ServiceClient) {}

  async consentAllowed(
    personId: string,
    purpose: ConsentPurpose,
    correlationId?: string,
  ): Promise<boolean> {
    const q = new URLSearchParams({ personId, purpose });
    const r = await this.client.call<{ allowed: boolean }>('identity', `/consents/check?${q}`, {
      correlationId,
    });
    return r.allowed;
  }

  nadraVerify(cnic: string, fullName: string, correlationId?: string) {
    return this.client.call<NadraVerifyResponse>('rails-mock', '/mock/nadra/verify', {
      method: 'POST',
      body: { cnic, fullName },
      idempotencyKey: `nadra:${cnic}`,
      correlationId,
    });
  }

  /** `null` when no household record exists (404); throws when the service is unavailable. */
  async household(cnic: string, correlationId?: string): Promise<HouseholdRecord | null> {
    try {
      return await this.client.call<HouseholdRecord>(
        'rails-mock',
        `/mock/household/${encodeURIComponent(cnic)}`,
        {
          correlationId,
        },
      );
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 404) return null;
      throw e;
    }
  }
}
