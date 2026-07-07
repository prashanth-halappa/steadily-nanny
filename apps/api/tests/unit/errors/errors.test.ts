import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
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
