import { describe, expect, test } from 'bun:test';
import { ZodError, z } from 'zod';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../../../src/errors';

describe('error → generic ErrorCode mapping', () => {
  test('AuthenticationError maps to UNAUTHORIZED (401)', () => {
    const e = new AuthenticationError('nope');
    expect(e.code).toBe('UNAUTHORIZED');
    expect(e.statusCode).toBe(401);
  });

  test('AuthorizationError maps to FORBIDDEN (403), preserving reason', () => {
    const e = new AuthorizationError('no access', 'INSUFFICIENT_PERMISSIONS');
    expect(e.code).toBe('FORBIDDEN');
    expect(e.statusCode).toBe(403);
    expect(e.metadata?.reason).toBe('INSUFFICIENT_PERMISSIONS');
  });

  test('DatabaseError maps to INTERNAL_ERROR (500), keeping the reason label', () => {
    const e = new DatabaseError('boom', 'DATABASE_ERROR', { op: 'x' });
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.statusCode).toBe(500);
    expect(e.metadata?.reason).toBe('DATABASE_ERROR');
  });

  test('NotFoundError → NOT_FOUND, ConflictError → CONFLICT', () => {
    expect(new NotFoundError('missing').code).toBe('NOT_FOUND');
    expect(new ConflictError('dup').code).toBe('CONFLICT');
  });

  test('ValidationError.fromZodError → VALIDATION_ERROR (400)', () => {
    const zerr = new ZodError([
      { code: 'custom', message: 'bad', path: ['field'] },
    ]);
    const e = ValidationError.fromZodError(zerr);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.statusCode).toBe(400);
  });
});

// A bare 'Validation failed' tells an integrator (and a log reader) nothing
// about WHICH field failed — the per-field `details` were already there, but
// the message is what a human reads first and what most tooling surfaces.
describe('ValidationError.fromZodError — the message names the fields', () => {
  test('folds one failing path and its reason into the message', () => {
    const e = ValidationError.fromZodError(
      new ZodError([
        {
          code: 'invalid_type',
          message: 'Invalid input: expected number, received undefined',
          path: ['year'],
          expected: 'number',
        },
      ])
    );
    expect(e.message).toBe(
      'Validation failed: year (Invalid input: expected number, received undefined)'
    );
  });

  test('joins multiple paths, capped at the first 3 issues', () => {
    const e = ValidationError.fromZodError(
      new ZodError(
        ['a', 'b', 'c', 'd'].map(p => ({
          code: 'custom' as const,
          message: `bad ${p}`,
          path: [p],
        }))
      )
    );
    expect(e.message).toBe(
      'Validation failed: a (bad a), b (bad b), c (bad c) (+1 more)'
    );
  });

  test('a root-level issue with no path still reads sensibly', () => {
    const e = ValidationError.fromZodError(
      new ZodError([{ code: 'custom', message: 'nope', path: [] }])
    );
    expect(e.message).toBe('Validation failed: (root) (nope)');
  });

  test('leaves the per-field details untouched', () => {
    const e = ValidationError.fromZodError(
      new ZodError([{ code: 'custom', message: 'bad', path: ['field'] }])
    );
    expect(e.metadata?.details).toEqual([
      { path: 'field', message: 'bad', code: 'custom' },
    ]);
  });

  test('a missing required query param names it — PtoYearQuerySchema shape', () => {
    const parsed = z
      .object({ year: z.coerce.number().int().min(2000).max(2100) })
      .safeParse({});
    expect(parsed.success).toBe(false);
    const e = ValidationError.fromZodError(parsed.error as ZodError);
    expect(e.message).toContain('year');
    expect(e.message).not.toBe('Validation failed');
  });
});

describe('BaseError client serialization', () => {
  test('toClientJSON hides metadata for 5xx', () => {
    const e = new DatabaseError('boom', 'DATABASE_ERROR', { secret: 'x' });
    const client = e.toClientJSON();
    expect(client.error.code).toBe('INTERNAL_ERROR');
    expect('metadata' in client.error).toBe(false);
  });

  test('toClientJSON keeps metadata for 4xx (client-informative)', () => {
    const e = new NotFoundError('missing', 'RESOURCE_NOT_FOUND', { id: '42' });
    const client = e.toClientJSON();
    expect(client.error.code).toBe('NOT_FOUND');
    expect('metadata' in client.error).toBe(true);
  });
});
