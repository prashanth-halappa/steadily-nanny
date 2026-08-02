import { describe, expect, it } from 'bun:test';
import type { Result } from '../src/result';
import { Result as R } from '../src/result';

describe('Result', () => {
  describe('ok / fail', () => {
    it('ok wraps data with success true', () => {
      const r = R.ok(42);
      expect(r.success).toBe(true);
      expect(r.data).toBe(42);
    });

    it('fail wraps an error with success false', () => {
      const err = new Error('boom');
      const r = R.fail(err);
      expect(r.success).toBe(false);
      expect(r.error).toBe(err);
    });
  });

  describe('isOk / isFail', () => {
    it('isOk narrows a success', () => {
      const r = R.ok('x');
      expect(R.isOk(r)).toBe(true);
      expect(R.isFail(r)).toBe(false);
    });

    it('isFail narrows a failure', () => {
      const r = R.fail('nope');
      expect(R.isFail(r)).toBe(true);
      expect(R.isOk(r)).toBe(false);
    });
  });

  describe('map', () => {
    it('maps data on success', () => {
      expect(R.map(R.ok(2), n => n * 3)).toEqual(R.ok(6));
    });

    it('passes a failure through unchanged', () => {
      const failure: Result<number, string> = R.fail('e');
      expect(R.map<number, number, string>(failure, n => n * 3)).toBe(failure);
    });
  });

  describe('mapError', () => {
    it('maps the error on failure', () => {
      expect(R.mapError(R.fail('e'), e => `${e}!`)).toEqual(R.fail('e!'));
    });

    it('passes a success through unchanged', () => {
      const success: Result<number, string> = R.ok(1);
      expect(R.mapError<number, string, string>(success, e => e)).toBe(success);
    });
  });

  describe('flatMap', () => {
    it('chains on success', () => {
      expect(R.flatMap(R.ok(2), n => R.ok(n + 1))).toEqual(R.ok(3));
    });

    it('short-circuits on failure', () => {
      const failure: Result<number, string> = R.fail('e');
      expect(R.flatMap<number, number, string>(failure, n => R.ok(n + 1))).toBe(
        failure
      );
    });
  });

  describe('getOrElse', () => {
    it('returns data on success', () => {
      expect(R.getOrElse(R.ok(5), 0)).toBe(5);
    });

    it('returns the default on failure', () => {
      const failure: Result<number, string> = R.fail('e');
      expect(R.getOrElse(failure, 0)).toBe(0);
    });
  });

  describe('getOrThrow', () => {
    it('returns data on success', () => {
      expect(R.getOrThrow(R.ok('v'))).toBe('v');
    });

    it('throws the error on failure', () => {
      expect(() => R.getOrThrow(R.fail(new Error('boom')))).toThrow('boom');
    });
  });

  describe('fromPromise', () => {
    it('resolves to ok on success', async () => {
      expect(await R.fromPromise(Promise.resolve(7))).toEqual(R.ok(7));
    });

    it('resolves to fail on rejection', async () => {
      const err = new Error('rejected');
      const r = await R.fromPromise(Promise.reject(err));
      expect(R.isFail(r)).toBe(true);
      if (R.isFail(r)) {
        expect(r.error).toBe(err);
      }
    });

    it('applies the error mapper on rejection', async () => {
      const r = await R.fromPromise(Promise.reject(new Error('x')), e =>
        (e as Error).message.toUpperCase()
      );
      expect(r).toEqual(R.fail('X'));
    });
  });
});
