/**
 * @module domains/pay/components/TermGroup
 *
 * The progressive-groups expander (D-3, `docs/design/screens-pay-terms.md`
 * §4.2).
 *
 * SIMPLIFICATION, documented (not silent): the spec names the existing
 * `Collapsible` (`@rn-primitives/collapsible`) as the building block, and an
 * `Accordion` (`@rn-primitives/accordion`) already ships in this repo with
 * the exact chevron-rotation behavior this component wants. Both were tried
 * here first. Neither can be exercised under `bun:test`: `@rn-primitives/*`
 * ships its React Native entry point (both the `import` and `require`
 * conditions) as JSX-PRESERVED source — meant for Metro's own Babel
 * transform at bundle time — and Bun's test loader picks its JSX transform
 * from the file EXTENSION (`.tsx`/`.jsx`), never from content, so a `.mjs`/
 * `.js` file containing raw JSX fails to parse the moment the module graph
 * reaches it (`Unexpected <` at `@rn-primitives/accordion/dist/accordion.mjs`).
 * That is a gap in the test toolchain's handling of this dependency family,
 * not a defect in this component, but this slice's job is a working,
 * TESTED terms form, not a toolchain fix — so `TermGroup` is built on plain
 * `useState` + `Pressable` instead: zero new dependencies (the ladder's
 * rung 2, "already in this codebase" — React itself), fully renderable
 * under `bun:test`, and behaviourally identical from a screen's point of
 * view (open/closed, `defaultOpen`, a chevron that flips). The one thing
 * given up is the chevron's 180ms rotation ANIMATION (§4.2's polish detail);
 * it still flips instantly. Add the primitive back once bun:test's loader
 * (or the package's dist shape) can parse it.
 *
 * A screen renders every group independently (no shared "close the others"
 * behaviour is specified) and computes each one's `defaultOpen` once, from
 * the seeded form state — §4.2's rule ("a group opens by default when it
 * has a value, and stays closed when it does not") is the SCREEN's job;
 * `TermGroup` itself carries no notion of "has a value".
 *
 * ENABLEMENT IS GROUP-LEVEL, NOT FIELD-LEVEL (3-E2 hand-off note). The
 * earlier draft of this spec's §4.3 said "the multiplier field is disabled
 * and greyed while its threshold is blank" — but the seventh-day tier
 * reuses `doubletime_multiplier` for its OWN second tier independently of
 * whether `doubletime_daily_threshold_minutes` is set (078's header), so a
 * field-level disable on that shared multiplier would make a two-tier
 * seventh day with no daily double-time tier impossible to enter. This
 * component resolves the tension the way the hand-off note suggests: there
 * is no field-level enable/disable ANYWHERE inside a group — every field is
 * always editable once the group is open, and invalid COMBINATIONS are
 * refused at submit time by the existing pure validators in
 * `payArrangementForm.ts` (which already refuse a doubletime threshold with
 * no multiplier, mismatched tier ordering, etc.). The group's only
 * enable/disable moment is the chevron itself: open or closed.
 */
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown } from '@/lib/icons/ChevronDown';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Body, Small } from '@/src/components/ui/typography';

export interface TermGroupProps {
  icon: LucideIcon;
  label: string;
  /**
   * The term's real value, formatted exactly as the read-only document
   * formats it (spec: "a closed sheet must read as a complete contract").
   * "Not set" when the group has nothing agreed.
   */
  collapsedSummary: string;
  /** §4.2: opens by default when the group has a value. */
  defaultOpen?: boolean;
  children: ReactNode;
  testID?: string;
}

export function TermGroup({
  icon,
  label,
  collapsedSummary,
  defaultOpen = false,
  children,
  testID,
}: TermGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        className="min-h-14 flex-row items-center gap-3 px-4 py-3"
      >
        <IconChip tone="hours" icon={icon} />
        <Body weight="medium" className="flex-1 text-foreground">
          {label}
        </Body>
        <Small
          testID={testID ? `${testID}-summary` : undefined}
          className="text-muted-foreground tabular-nums"
          numberOfLines={1}
        >
          {collapsedSummary}
        </Small>
        <ChevronDown
          size={20}
          className="text-muted-foreground"
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open ? (
        <View
          testID={testID ? `${testID}-content` : undefined}
          className="gap-4 px-4 pb-4"
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
