/**
 * Mechanical design guards — static scans for known styling foot-guns.
 *
 * @module components/ui/__tests__/design-guards/mechanical.test
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const scanRoot = join(import.meta.dir, '../../../../');

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativePath(absolutePath: string): string {
  return relative(scanRoot, absolutePath);
}

function isExcludedPath(relativeFilePath: string): boolean {
  return (
    relativeFilePath.includes('__tests__') || relativeFilePath.includes('.test.')
  );
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('*') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*')
  );
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function formatViolation(relativeFilePath: string, lineNumber: number, line: string): string {
  return `${relativeFilePath}:${lineNumber}  ${line.trim()}`;
}

function findAnimatedOpeningTagEnd(content: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === '>' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function scanReanimatedClassNameViolations(): string[] {
  const violations: string[] = [];
  const tsxFiles = walkFiles(scanRoot).filter(
    filePath =>
      filePath.endsWith('.tsx') && !isExcludedPath(relativePath(filePath))
  );

  for (const filePath of tsxFiles) {
    const content = readFileSync(filePath, 'utf8');
    if (!content.includes("from 'react-native-reanimated'")) {
      continue;
    }

    const tagPattern = /<Animated\.[A-Za-z]+/g;
    let match = tagPattern.exec(content);
    while (match !== null) {
      const tagStart = match.index;
      const tagEnd = findAnimatedOpeningTagEnd(content, tagStart);
      if (tagEnd !== -1) {
        const openingTag = content.slice(tagStart, tagEnd + 1);
        if (openingTag.includes('className')) {
          const classNameIndex = openingTag.indexOf('className');
          const absoluteIndex = tagStart + classNameIndex;
          const lineNumber = lineNumberAt(content, absoluteIndex);
          const line = content.split('\n')[lineNumber - 1] ?? '';
          violations.push(
            formatViolation(relativePath(filePath), lineNumber, line)
          );
        }
      }
      match = tagPattern.exec(content);
    }
  }

  return violations.sort();
}

function scanRawHexViolations(): string[] {
  const violations: string[] = [];
  const hexPattern = /#[0-9a-fA-F]{6}\b/;
  const sourceFiles = walkFiles(scanRoot).filter(filePath => {
    const rel = relativePath(filePath);
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
      return false;
    }
    if (isExcludedPath(rel)) {
      return false;
    }
    if (rel.includes('widgets/')) {
      return false;
    }
    return true;
  });

  for (const filePath of sourceFiles) {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (isCommentLine(line)) {
        continue;
      }
      if (hexPattern.test(line)) {
        violations.push(
          formatViolation(relativePath(filePath), index + 1, line)
        );
      }
    }
  }

  return violations.sort();
}

function scanArbitraryTailwindViolations(): string[] {
  const violations: string[] = [];
  const classNamePattern = /className="[^"]*\-\[[^"]*"/g;
  const tsxFiles = walkFiles(scanRoot).filter(
    filePath =>
      filePath.endsWith('.tsx') && !isExcludedPath(relativePath(filePath))
  );

  for (const filePath of tsxFiles) {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (classNamePattern.test(line)) {
        violations.push(
          formatViolation(relativePath(filePath), index + 1, line)
        );
      }
      classNamePattern.lastIndex = 0;
    }
  }

  return violations.sort();
}

describe('mechanical design guards', () => {
  it('GUARD 1: no NativeWind className on a Reanimated Animated.* opening tag', () => {
    const violations = scanReanimatedClassNameViolations();
    expect(violations).toEqual([]);
  });

  it('GUARD 2: no raw hex colour in shipped components', () => {
    const violations = scanRawHexViolations();
    expect(violations).toEqual([]);
  });

  it('GUARD 3: no arbitrary Tailwind values in className string literals', () => {
    const violations = scanArbitraryTailwindViolations();
    expect(violations).toEqual([]);
  });
});
