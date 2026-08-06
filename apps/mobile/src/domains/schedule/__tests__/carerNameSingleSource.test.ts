/**
 * @module domains/schedule/__tests__/carerNameSingleSource
 *
 * One resolver, not seven. Seven screens each hand-rolled
 * `display_name_override?.trim() || label`, which skipped the joined
 * `profile_name` and the row's `carer_display_name` snapshot — two
 * un-renamed nannies then rendered as the same word twice, and a departed
 * carer's real name sat unread on rows the screen had just attributed to
 * her. This scan fails if any production file reads either raw name field
 * outside `resolveCarerName`, so the next screen can't quietly re-roll it.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

/** The one file allowed to read the raw name fields. */
const RESOLVER = 'src/domains/schedule/utils/memberDisplayName.ts';
const MOBILE_ROOT = join(__dirname, '../../../..');

let offenders: string[] = [];

beforeAll(async () => {
  const glob = new Bun.Glob('{src,lib}/**/*.{ts,tsx}');
  const found: string[] = [];
  for await (const relative of glob.scan({
    cwd: MOBILE_ROOT,
    onlyFiles: true,
  })) {
    if (
      relative === RESOLVER ||
      relative.includes('__tests__') ||
      relative.includes('.test.')
    ) {
      continue;
    }
    const source = await Bun.file(join(MOBILE_ROOT, relative)).text();
    if (/display_name_override|profile_name/.test(source)) {
      found.push(relative);
    }
  }
  offenders = found.sort();
});

describe('carer display name has a single source', () => {
  it('no production file reads display_name_override or profile_name directly', () => {
    expect(offenders).toEqual([]);
  });
});
