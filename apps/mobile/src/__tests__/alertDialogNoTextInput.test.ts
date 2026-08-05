import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: never put a text input inside `AlertDialogContent`.
 *
 * AlertDialog portals into a centered Modal with no KeyboardAvoidingView,
 * no ScrollView, and no maxHeight. The footer is `flex-col`, so the confirm
 * button is the bottom-most element — the first thing a software keyboard
 * covers. Commit `d003196` hit this with ReopenWeekDialog (required Textarea);
 * delete-account and schedule-decline were the same trap on device.
 *
 * Input-bearing confirms belong in `BottomSheetBase` (`fitContent`), which
 * owns KeyboardAvoidingView + ScrollView. Comments are stripped before
 * matching so doc comments explaining this rule do not trip it (same shape
 * as `noBareModal.test.ts`).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CONTENT_BLOCK = /<AlertDialogContent\b[\s\S]*?<\/AlertDialogContent>/g;
const TEXT_INPUT = /<(?:Input|Textarea|TextInput)\b/;

function alertDialogContentBlocksWithTextInput(source: string): string[] {
  const stripped = stripComments(source);
  const offenders: string[] = [];
  for (const match of stripped.matchAll(CONTENT_BLOCK)) {
    const block = match[0] ?? '';
    if (TEXT_INPUT.test(block)) offenders.push(block);
  }
  return offenders;
}

describe('guardrail: no text input inside AlertDialogContent', () => {
  it('finds no Input/Textarea/TextInput inside AlertDialogContent in app source', async () => {
    const offenders: string[] = [];
    const glob = new Glob('{src,lib}/**/*.tsx');
    for await (const file of glob.scan({
      cwd: process.cwd(),
      absolute: true,
    })) {
      if (file.includes('__tests__') || file.endsWith('.test.tsx')) continue;
      const content = readFileSync(file, 'utf8');
      if (alertDialogContentBlocksWithTextInput(content).length > 0) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still catches a real text input inside AlertDialogContent', () => {
    // The guardrail must not be so lenient it stops working. A JSX usage
    // survives comment-stripping; the same text inside a comment does not;
    // a content block without an input is clean.
    expect(
      alertDialogContentBlocksWithTextInput(
        '<AlertDialogContent><Textarea value="" /></AlertDialogContent>'
      ).length
    ).toBe(1);
    expect(
      alertDialogContentBlocksWithTextInput(
        '<AlertDialogContent><Body>ok</Body></AlertDialogContent>'
      ).length
    ).toBe(0);
    expect(
      alertDialogContentBlocksWithTextInput(
        '// <AlertDialogContent><Textarea /></AlertDialogContent>'
      ).length
    ).toBe(0);
    expect(
      alertDialogContentBlocksWithTextInput(
        '/** <AlertDialogContent><Input /></AlertDialogContent> */'
      ).length
    ).toBe(0);
  });
});
