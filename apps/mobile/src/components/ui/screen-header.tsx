/**
 * @module components/ui/screen-header
 *
 * The hero-band primitive (Rule H): a screen title, at most one context
 * line, and at most one anchor. 27 screens used to hand-roll this block —
 * `BackButton + H1 + subtitle` — with a drifting `mt-1`, a drifting subtitle
 * component (`Small` vs `Body`), and a drifting muted colour. The Schedule
 * screen took that drift furthest, stacking SEVEN things under its H1
 * (title, subtitle, lead sentence, date range, an hours figure, a "usual
 * week" row, and a warning count) — see `ScheduleShiftsScreen`.
 *
 * Rule H caps the band at three elements:
 *   1. `title` — the H1 (32/40/700; it used to be 600, lighter than the H3
 *      and figure tokens beneath it, which is why titles "read small").
 *   2. `contextLine` — exactly one `Small`, `text-muted-strong` (never
 *      `text-muted-foreground` — this band sits on the screen wash, where
 *      `mutedForeground` measures 4.28:1 and fails AA. Rule M.).
 *   3. One anchor, in ONE of two shapes — pass at most one of these two
 *      props, never both: `anchor` (a figure slot below the context line,
 *      e.g. a week total) or `titleAction` (a trailing action rendered
 *      INLINE on the title line, right-aligned, baseline-aligned — never on
 *      its own row). Whichever is used, it must never be visually bolder
 *      than the title.
 *
 * The band is NOT a card: no ground of its own, no shadow, no radius — it
 * IS the top of the wash, exactly like `TodayScreen`'s `HEADER_STYLE`.
 *
 * `backButton` and `trailingAction` are NAVIGATION CHROME, not band
 * elements — they sit outside Rule H's three and do not count against the
 * one-anchor cap. `trailingAction` renders last in the outer row (the
 * settings gear, since WP-C made Settings a pushed screen), never inside
 * the title column, so it can never squeeze the H1.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens/spacing';
import { H1, Small } from '@/src/components/ui/typography';

const BAND_STYLE = {
  paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
  paddingTop: SCREEN_CONTENT_STYLE.padding,
  paddingBottom: 8,
} as const;

interface ScreenHeaderProps {
  title: string;
  /** Exactly one context line — `Small`, `text-muted-strong`. */
  contextLine?: string;
  /** A figure slot below the context line (e.g. a week total). At most one
   * of `anchor` / `titleAction` — see module docs. */
  anchor?: ReactNode;
  /** A trailing action inline on the title line, right-aligned. At most one
   * of `anchor` / `titleAction` — see module docs. */
  titleAction?: ReactNode;
  /** Rendered above the title. Pass an existing `BackButton`, not built here. */
  backButton?: ReactNode;
  /** Navigation chrome pinned to the end of the outer row — e.g.
   * `SettingsHeaderButton`. Outside Rule H's three band elements. */
  trailingAction?: ReactNode;
  /** Right-hand illustration (e.g. Today's 104x104 mood art). The title
   * column stays `flex-1` and is never squeezed by it. */
  art?: ReactNode;
  /**
   * This household takes no writes any more — her membership ended, or the
   * family closed their account. ONE chip, under the title, on every tab
   * that shows household data: the alternative is a banner per screen, which
   * by the third one reads as an error state rather than a context. The
   * explanation itself lives in exactly one place (Today's pinned card); this
   * is only the reminder that carries it to the other tabs.
   *
   * Chip, never a filled pill: green/ochre/terracotta mean confirmed/pending/
   * declined, and read-only is a context, not a status. Chips are one of the
   * sanctioned exceptions to the no-1px-borders rule.
   */
  readOnly?: boolean;
  testID?: string;
}

export function ScreenHeader({
  title,
  contextLine,
  anchor,
  titleAction,
  backButton,
  trailingAction,
  art,
  readOnly = false,
  testID = 'screen-header',
}: ScreenHeaderProps) {
  const { t } = useTranslation('common');

  return (
    <View testID={testID} style={BAND_STYLE}>
      {backButton}
      <View className="flex-row items-start justify-between gap-3">
        <View testID={`${testID}-title-column`} className="flex-1">
          <View
            testID={`${testID}-title-row`}
            className="flex-row items-baseline justify-between gap-3"
          >
            <H1 testID={`${testID}-title`} className="flex-1">
              {title}
            </H1>
            {titleAction}
          </View>
          {readOnly ? (
            <View
              testID={`${testID}-read-only`}
              className="mt-1 flex-row items-center gap-1 self-start rounded-chip border border-border bg-card px-3 py-1"
            >
              <Small className="text-muted-foreground">
                {t('readOnlyBadge')}
              </Small>
            </View>
          ) : null}
          {contextLine ? (
            <Small
              testID={`${testID}-context`}
              className="mt-1 text-muted-strong"
            >
              {contextLine}
            </Small>
          ) : null}
          {anchor}
        </View>
        {art}
        {trailingAction}
      </View>
    </View>
  );
}

export type { ScreenHeaderProps };
