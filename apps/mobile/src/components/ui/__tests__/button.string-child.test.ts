/**
 * @module components/ui/__tests__/button.string-child
 *
 * Load-bearing case: `Button` spreads into `AnimatedPressable`, which renders
 * children verbatim. A raw string child used to vanish — RN logs "Text strings
 * must be rendered within a <Text> component" and the button renders with no
 * label (AgendaView's uncovered-care actions, Aug 2026). Button wraps it now.
 *
 * Pattern A (source inspection): `@/src/components/ui/button` is mocked
 * globally in bun.setup.ts, so Button cannot be rendered in a component test.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUTTON_SRC = readFileSync(join(import.meta.dir, '../button.tsx'), 'utf8');

describe('Button string children', () => {
  it('wraps a raw string child in <Text>', () => {
    expect(BUTTON_SRC).toMatch(
      /typeof children === 'string' \? <Text>\{children\}<\/Text> : children/
    );
  });

  it('destructures children rather than spreading it through props', () => {
    expect(BUTTON_SRC).toMatch(/function Button\(\{[^}]*\bchildren\b[^}]*\}/);
  });
});
