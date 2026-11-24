/**
 * Legal acceptance service — status lookup and version-checked, idempotent
 * append-only acceptance recording.
 *
 * @module domains/legal/services/legalService
 */
import {
  type AcceptLegalRequest,
  CURRENT_LEGAL_VERSION,
  type LegalStatus,
  needsLegalAcceptance,
} from '@steadily-nanny/shared-types';
import { LegalVersionMismatchError } from '../errors/legalErrors';
import {
  type LegalAcceptanceRepository,
  legalAcceptanceRepository,
} from '../repositories/legalAcceptanceRepository';

const MAX_USER_AGENT_LENGTH = 512;

export interface LegalAcceptContext {
  ip: string | null;
  userAgent: string | null;
}

export class LegalService {
  constructor(
    private readonly repo: LegalAcceptanceRepository = legalAcceptanceRepository
  ) {}

  async getStatus(userId: string): Promise<LegalStatus> {
    const latest = await this.repo.findLatestForUser(userId);
    const acceptedVersion = latest?.version ?? null;
    return {
      currentVersion: CURRENT_LEGAL_VERSION,
      acceptedVersion,
      acceptedAt: latest?.accepted_at ?? null,
      needsAcceptance: needsLegalAcceptance(acceptedVersion),
    };
  }

  async accept(
    userId: string,
    input: AcceptLegalRequest,
    ctx: LegalAcceptContext
  ): Promise<LegalStatus> {
    if (input.version !== CURRENT_LEGAL_VERSION) {
      throw new LegalVersionMismatchError(input.version, CURRENT_LEGAL_VERSION);
    }

    const userAgent =
      ctx.userAgent === null
        ? null
        : ctx.userAgent.slice(0, MAX_USER_AGENT_LENGTH);

    await this.repo.insertIfAbsent({
      user_id: userId,
      version: input.version,
      accepted_at: new Date().toISOString(),
      ip: ctx.ip,
      user_agent: userAgent,
      platform: input.platform ?? null,
      app_version: input.appVersion ?? null,
    });

    return this.getStatus(userId);
  }
}

export const legalService = new LegalService();
