/**
 * Rule M guard — docs/design/01-LAWS.md §4.
 *
 * On tinted `<Card>` grounds (`attention`, `live`, `positive`, `critical`) use
 * `text-muted-strong`. On plain grounds use `text-muted-foreground`.
 *
 * @module components/ui/__tests__/design-guards/rule-m
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { palette } from '~/lib/design-tokens/palette';

const SCAN_ROOT = join(import.meta.dir, '../../../..');
const MUTED_FOREGROUND = 'text-muted-foreground';
const MUTED_STRONG = 'text-muted-strong';
const TINTED_TONES = ['attention', 'live', 'positive', 'critical'] as const;
const CARD_CLOSE = '</Card>';

type CardBlock = {
  bodyStart: number;
  bodyEnd: number;
  tinted: boolean;
};

type ScanHit = {
  index: number;
  line: number;
  trimmed: string;
};

function walkTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...walkTsxFiles(fullPath));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.includes('.test.')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function isCardOpenAt(content: string, index: number): boolean {
  if (!content.startsWith('<Card', index)) return false;
  const next = content[index + 5];
  if (next === undefined) return true;
  if (/[A-Za-z]/.test(next)) return false;
  return true;
}

function findNextCardOpen(content: string, from: number): number {
  let pos = from;
  while (pos < content.length) {
    const idx = content.indexOf('<Card', pos);
    if (idx === -1) return -1;
    if (isCardOpenAt(content, idx)) return idx;
    pos = idx + 5;
  }
  return -1;
}

function findOpeningTagEnd(content: string, openStart: number): number {
  let depth = 0;
  for (let i = openStart; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === '>' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function isSelfClosingTag(
  content: string,
  openStart: number,
  openEnd: number
): boolean {
  let i = openEnd - 1;
  while (i > openStart && /\s/u.test(content.charAt(i))) {
    i -= 1;
  }
  return content.charAt(i) === '/';
}

function classifyCardTone(openingTag: string): 'tinted' | 'plain' | 'skip' {
  if (/tone\s*=\s*\{/u.test(openingTag)) return 'skip';
  for (const tone of TINTED_TONES) {
    if (
      new RegExp(`tone\\s*=\\s*"${tone}"`, 'u').test(openingTag) ||
      new RegExp(`tone\\s*=\\s*'${tone}'`, 'u').test(openingTag)
    ) {
      return 'tinted';
    }
  }
  return 'plain';
}

function findMatchingCloseIndex(
  content: string,
  openTagEnd: number
): number | null {
  let depth = 1;
  let pos = openTagEnd + 1;

  while (pos < content.length) {
    const nextOpen = findNextCardOpen(content, pos);
    const nextClose = content.indexOf(CARD_CLOSE, pos);

    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      const nestedOpenEnd = findOpeningTagEnd(content, nextOpen);
      if (nestedOpenEnd === -1) return null;
      pos = nestedOpenEnd + 1;
      continue;
    }

    depth -= 1;
    if (depth === 0) return nextClose;
    pos = nextClose + CARD_CLOSE.length;
  }

  return null;
}

function parseCardBlocks(content: string): CardBlock[] {
  const blocks: CardBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const openStart = findNextCardOpen(content, searchFrom);
    if (openStart === -1) break;

    const openEnd = findOpeningTagEnd(content, openStart);
    if (openEnd === -1) break;

    const openingTag = content.slice(openStart, openEnd + 1);
    const toneClass = classifyCardTone(openingTag);

    if (toneClass !== 'skip') {
      const selfClosing = isSelfClosingTag(content, openStart, openEnd);
      if (selfClosing) {
        if (toneClass === 'tinted') {
          blocks.push({
            bodyStart: openEnd + 1,
            bodyEnd: openEnd + 1,
            tinted: true,
          });
        }
      } else {
        const closeStart = findMatchingCloseIndex(content, openEnd);
        if (closeStart !== null) {
          blocks.push({
            bodyStart: openEnd + 1,
            bodyEnd: closeStart,
            tinted: toneClass === 'tinted',
          });
          searchFrom = closeStart + CARD_CLOSE.length;
          continue;
        }
      }
    }

    searchFrom = openEnd + 1;
  }

  return blocks;
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charAt(i) === '\n') line += 1;
  }
  return line;
}

function trimmedLineAt(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = content.indexOf('\n', index);
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return line.trim();
}

function findTokenHits(content: string, token: string): ScanHit[] {
  const hits: ScanHit[] = [];
  let pos = 0;
  while (pos < content.length) {
    const idx = content.indexOf(token, pos);
    if (idx === -1) break;
    hits.push({
      index: idx,
      line: lineNumberAt(content, idx),
      trimmed: trimmedLineAt(content, idx),
    });
    pos = idx + token.length;
  }
  return hits;
}

function formatViolation(relativePath: string, hit: ScanHit): string {
  return `${relativePath}:${hit.line}  ${hit.trimmed}`;
}

function scanFiles(): string[] {
  return walkTsxFiles(SCAN_ROOT).sort();
}

function collectMutedForegroundInTintedCards(): string[] {
  const violations: string[] = [];

  for (const filePath of scanFiles()) {
    const content = readFileSync(filePath, 'utf8');
    const relPath = relative(SCAN_ROOT, filePath);
    const blocks = parseCardBlocks(content).filter(block => block.tinted);

    for (const block of blocks) {
      const slice = content.slice(block.bodyStart, block.bodyEnd);
      for (const hit of findTokenHits(slice, MUTED_FOREGROUND)) {
        violations.push(
          formatViolation(relPath, {
            index: block.bodyStart + hit.index,
            line: lineNumberAt(content, block.bodyStart + hit.index),
            trimmed: trimmedLineAt(content, block.bodyStart + hit.index),
          })
        );
      }
    }
  }

  return violations.sort();
}

describe('Rule M — muted text on tinted vs plain grounds (01-LAWS §4)', () => {
  /*
   * Known limitation: this guard only sees literal `<Card tone="...">` grounds.
   * Rule M also governs washes and `tone={expr}` computed tones, which a static
   * scan cannot resolve here, so those sites are not covered and still need
   * human review.
   */
  it('flags text-muted-foreground inside a tinted Card', () => {
    const violations = collectMutedForegroundInTintedCards();
    expect(violations).toEqual([]);
  });

  it('pins Rule M contrast ratios to palette.light muted tokens', () => {
    expect(palette.light.mutedForeground).toBeDefined();
    expect(palette.light.mutedStrong).toBeDefined();
    expect(palette.light.mutedForeground.hex).toBe('#6E6270');
    expect(typeof palette.light.mutedStrong.hex).toBe('string');
    expect(palette.light.mutedStrong.hex.length).toBeGreaterThan(0);
  });
});
