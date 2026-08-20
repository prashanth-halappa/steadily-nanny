/**
 * Ink-token guard: semantic FILL tokens must not appear as text colour.
 * Pair each fill with its ink token (destructive → error-inline-text, etc.).
 *
 * @module components/ui/__tests__/design-guards/ink-tokens.test
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const scanRoot = join(import.meta.dir, '../../../../');
const tailwindConfigPath = join(
  import.meta.dir,
  '../../../../../tailwind.config.js'
);

/** FILL tokens used as text colour — use the paired *-ink token instead. */
const FILL_AS_TEXT_PATTERN =
  /\btext-(destructive|warning|success|short-notice)(?!-)/g;

function pathIsExcluded(relativePath: string): boolean {
  return relativePath.includes('__tests__') || relativePath.includes('.test.');
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    const relativePath = relative(scanRoot, absolutePath);
    if (pathIsExcluded(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

function scanForFillAsTextViolations(): string[] {
  const violations: string[] = [];
  for (const filePath of collectSourceFiles(scanRoot).sort()) {
    const relativePath = relative(scanRoot, filePath);
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line === undefined) {
        continue;
      }
      FILL_AS_TEXT_PATTERN.lastIndex = 0;
      if (FILL_AS_TEXT_PATTERN.test(line)) {
        violations.push(`${relativePath}:${lineIndex + 1}  ${line.trim()}`);
      }
    }
  }
  return violations;
}

describe('ink token guard', () => {
  it('does not use FILL tokens as text colour (text-destructive, text-warning, text-success, text-short-notice)', () => {
    const violations = scanForFillAsTextViolations();
    expect(violations).toEqual([]);
  });

  it('exposes ink tokens in tailwind.config.js', () => {
    const tailwindConfig = readFileSync(tailwindConfigPath, 'utf8');
    expect(tailwindConfig).toContain('error-inline-text');
  });
});
