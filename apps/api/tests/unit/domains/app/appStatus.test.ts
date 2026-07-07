import { describe, expect, test } from 'bun:test';
import { compareVersions } from '../../../../src/domains/app/services/appStatusService';

describe('compareVersions', () => {
  test('detects an older current version', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
  });

  test('detects a newer current version', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  test('treats equal versions as 0 and tolerates differing segment counts', () => {
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
  });
});
