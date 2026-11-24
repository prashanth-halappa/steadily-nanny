/**
 * Unit tests for LegalService — legal status computation, version mismatch
 * enforcement, audit-trail metadata pass-through/truncation, and idempotent
 * acceptance.
 *
 * @module tests/unit/domains/legal/services/legalService
 */
import { describe, expect, it, mock } from 'bun:test';
import { CURRENT_LEGAL_VERSION } from '@steadily-nanny/shared-types';
import { LegalVersionMismatchError } from '../../../../../src/domains/legal/errors/legalErrors';
import type {
  InsertLegalAcceptanceInput,
  LatestLegalAcceptance,
  LegalAcceptanceRepository,
} from '../../../../../src/domains/legal/repositories/legalAcceptanceRepository';
import { LegalService } from '../../../../../src/domains/legal/services/legalService';

interface RepoOverrides {
  findLatestForUser?: ReturnType<
    typeof mock<(userId: string) => Promise<LatestLegalAcceptance | null>>
  >;
  insertIfAbsent?: ReturnType<
    typeof mock<(row: InsertLegalAcceptanceInput) => Promise<boolean>>
  >;
}

function makeRepo(overrides: RepoOverrides = {}) {
  const findLatestForUser =
    overrides.findLatestForUser ??
    mock(
      async (_userId: string): Promise<LatestLegalAcceptance | null> => null
    );
  const insertIfAbsent =
    overrides.insertIfAbsent ??
    mock(async (_row: InsertLegalAcceptanceInput): Promise<boolean> => true);

  const repo = {
    findLatestForUser,
    insertIfAbsent,
  } as unknown as LegalAcceptanceRepository;

  return { repo, findLatestForUser, insertIfAbsent };
}

describe('LegalService', () => {
  describe('getStatus', () => {
    it('returns needsAcceptance true and null accepted fields when user has no rows', async () => {
      const { repo, findLatestForUser } = makeRepo();
      const service = new LegalService(repo);

      const status = await service.getStatus('user-1');

      expect(findLatestForUser).toHaveBeenCalledWith('user-1');
      expect(status).toEqual({
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: null,
        acceptedAt: null,
        needsAcceptance: true,
      });
    });

    it('returns needsAcceptance false when user accepted the current version', async () => {
      const acceptedAt = '2026-11-24T12:00:00.000Z';
      const { repo } = makeRepo({
        findLatestForUser: mock(async () => ({
          version: CURRENT_LEGAL_VERSION,
          accepted_at: acceptedAt,
        })),
      });
      const service = new LegalService(repo);

      const status = await service.getStatus('user-1');

      expect(status).toEqual({
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: CURRENT_LEGAL_VERSION,
        acceptedAt,
        needsAcceptance: false,
      });
    });

    it('returns needsAcceptance true when user only accepted an older version', async () => {
      const acceptedAt = '2020-01-02T08:00:00.000Z';
      const { repo } = makeRepo({
        findLatestForUser: mock(async () => ({
          version: '2020-01-01',
          accepted_at: acceptedAt,
        })),
      });
      const service = new LegalService(repo);

      const status = await service.getStatus('user-1');

      expect(status).toEqual({
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: '2020-01-01',
        acceptedAt,
        needsAcceptance: true,
      });
    });
  });

  describe('accept', () => {
    it('throws LegalVersionMismatchError and does not write when version is not current', async () => {
      const { repo, insertIfAbsent } = makeRepo();
      const service = new LegalService(repo);

      let thrown: unknown;
      try {
        await service.accept(
          'user-1',
          { version: '2020-01-01', platform: 'ios', appVersion: '1.0.0' },
          { ip: '203.0.113.10', userAgent: 'SteadilyNanny/1.0' }
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(LegalVersionMismatchError);
      const mismatch = thrown as LegalVersionMismatchError;
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.code).toBe('CONFLICT');
      expect(mismatch.metadata).toEqual({
        reason: 'LEGAL_VERSION_MISMATCH',
        submitted: '2020-01-01',
        current: CURRENT_LEGAL_VERSION,
      });
      expect(insertIfAbsent).not.toHaveBeenCalled();
    });

    it('inserts an acceptance row with an ISO accepted_at and request metadata when version is current', async () => {
      let recorded: InsertLegalAcceptanceInput | null = null;
      const insertIfAbsent = mock(async (row: InsertLegalAcceptanceInput) => {
        recorded = row;
        return true;
      });
      const findLatestForUser = mock(
        async (): Promise<LatestLegalAcceptance | null> =>
          recorded
            ? { version: recorded.version, accepted_at: recorded.accepted_at }
            : null
      );
      const { repo } = makeRepo({ insertIfAbsent, findLatestForUser });
      const service = new LegalService(repo);

      const status = await service.accept(
        'user-1',
        {
          version: CURRENT_LEGAL_VERSION,
          platform: 'ios',
          appVersion: '1.2.3',
        },
        { ip: '198.51.100.7', userAgent: 'SteadilyNanny/1.2.3 (iOS)' }
      );

      expect(insertIfAbsent).toHaveBeenCalledTimes(1);
      const inserted = insertIfAbsent.mock.calls[0]?.[0];
      expect(inserted).toBeDefined();
      expect(inserted?.user_id).toBe('user-1');
      expect(inserted?.version).toBe(CURRENT_LEGAL_VERSION);
      expect(inserted?.accepted_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
      expect(inserted?.ip).toBe('198.51.100.7');
      expect(inserted?.user_agent).toBe('SteadilyNanny/1.2.3 (iOS)');
      expect(inserted?.platform).toBe('ios');
      expect(inserted?.app_version).toBe('1.2.3');

      expect(status).toEqual({
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: CURRENT_LEGAL_VERSION,
        acceptedAt: inserted?.accepted_at ?? null,
        needsAcceptance: false,
      });
    });

    it('truncates user_agent to 512 characters before inserting', async () => {
      const longUserAgent = 'A'.repeat(600);
      const insertIfAbsent = mock(
        async (_row: InsertLegalAcceptanceInput) => true
      );
      const findLatestForUser = mock(async () => ({
        version: CURRENT_LEGAL_VERSION,
        accepted_at: '2026-11-24T12:00:00.000Z',
      }));
      const { repo } = makeRepo({ insertIfAbsent, findLatestForUser });
      const service = new LegalService(repo);

      await service.accept(
        'user-1',
        { version: CURRENT_LEGAL_VERSION },
        { ip: null, userAgent: longUserAgent }
      );

      const inserted = insertIfAbsent.mock.calls[0]?.[0];
      expect(inserted?.user_agent).toHaveLength(512);
      expect(inserted?.user_agent).toBe('A'.repeat(512));
    });

    it('is idempotent when insertIfAbsent returns false and still returns needsAcceptance false', async () => {
      const originalAcceptedAt = '2026-11-24T09:00:00.000Z';
      const insertIfAbsent = mock(
        async (_row: InsertLegalAcceptanceInput) => false
      );
      const findLatestForUser = mock(async () => ({
        version: CURRENT_LEGAL_VERSION,
        accepted_at: originalAcceptedAt,
      }));
      const { repo } = makeRepo({ insertIfAbsent, findLatestForUser });
      const service = new LegalService(repo);

      const status = await service.accept(
        'user-1',
        { version: CURRENT_LEGAL_VERSION, platform: 'android' },
        { ip: '203.0.113.20', userAgent: 'SteadilyNanny/1.2.3' }
      );

      expect(insertIfAbsent).toHaveBeenCalledTimes(1);
      expect(status).toEqual({
        currentVersion: CURRENT_LEGAL_VERSION,
        acceptedVersion: CURRENT_LEGAL_VERSION,
        acceptedAt: originalAcceptedAt,
        needsAcceptance: false,
      });
    });
  });
});
