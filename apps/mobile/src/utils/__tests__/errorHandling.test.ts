import { describe, expect, it } from 'bun:test';
import { getErrorVariant } from '../errorHandling';

describe('getErrorVariant', () => {
  it('returns network for axios network error (no response)', () => {
    const err = { isAxiosError: true, response: undefined };
    expect(getErrorVariant(err)).toBe('network');
  });

  it('returns network for error message containing network keyword', () => {
    const err = { message: 'Network Error' };
    expect(getErrorVariant(err)).toBe('network');
  });

  it('returns auth for 401 status', () => {
    const err = { isAxiosError: true, response: { status: 401 } };
    expect(getErrorVariant(err)).toBe('auth');
  });

  it('returns auth for 403 status', () => {
    const err = { isAxiosError: true, response: { status: 403 } };
    expect(getErrorVariant(err)).toBe('auth');
  });

  it('returns notFound for 404 status', () => {
    const err = { isAxiosError: true, response: { status: 404 } };
    expect(getErrorVariant(err)).toBe('notFound');
  });

  it('returns server for 500 status', () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    expect(getErrorVariant(err)).toBe('server');
  });

  it('returns server for null error', () => {
    expect(getErrorVariant(null)).toBe('server');
  });

  it('returns server for undefined error', () => {
    expect(getErrorVariant(undefined)).toBe('server');
  });

  it('returns server for ZodError', () => {
    const err = new Error('Validation failed');
    err.name = 'ZodError';
    expect(getErrorVariant(err)).toBe('server');
  });
});
