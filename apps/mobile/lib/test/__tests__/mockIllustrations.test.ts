/**
 * The illustrations test stub must cover every key in the real barrel.
 * A missing stub key means a PNG `require` is evaluated under bun:test.
 *
 * @module lib/test/__tests__/mockIllustrations.test
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

describe('mockIllustrations', () => {
  it('the illustration test stub covers every key in the real barrel', async () => {
    const realPath = join(__dirname, '../../../assets/illustrations/index.ts');
    const stubPath = join(__dirname, '../mockIllustrations.ts');
    const realSource = await Bun.file(realPath).text();
    const stubSource = await Bun.file(stubPath).text();

    const realKeys = [...realSource.matchAll(/^\s+(\w+):\s+require\(/gm)].map(
      match => match[1]
    );
    const stubKeys = [...stubSource.matchAll(/^\s+(\w+):\s+stubImage/gm)].map(
      match => match[1]
    );

    expect(stubKeys.sort()).toEqual(realKeys.sort());
  });
});
