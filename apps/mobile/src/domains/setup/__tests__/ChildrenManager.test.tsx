/**
 * @module domains/setup/__tests__/ChildrenManager.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) for the
 * add/edit/remove child list body extracted out of `ChildrenScreen` so it
 * can be reused, unchanged, by the settings entry point
 * (`ManageChildrenScreen`).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/ChildrenManager.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ChildrenManager', () => {
  it('exports the component', () => {
    expect(source).toContain('export function ChildrenManager');
  });

  it('takes a householdId prop rather than resolving one itself', () => {
    expect(source).toContain('householdId');
    expect(source).not.toContain('useCreateHousehold');
  });

  it('wires the add/edit/remove testIDs', () => {
    expect(source).toContain('children-add-button');
    expect(source).toContain('children-row-');
  });

  it('uses the CRUD mutation hooks', () => {
    expect(source).toContain('useCreateChild');
    expect(source).toContain('useUpdateChild');
    expect(source).toContain('useDeleteChild');
    expect(source).toContain('useChildren');
  });

  it('adds/edits through ChildFormSheet, never a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(source).toContain('ChildFormSheet');
    expect(source).not.toMatch(/<Modal\b/);
  });

  it('localizes its copy through the household namespace', () => {
    expect(source).toContain("useTranslation('household')");
    expect(source).not.toContain('"Add a child"');
  });
});
