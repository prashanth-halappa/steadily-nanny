/**
 * @module domains/today/__tests__/ClockInCard.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — the card pulls
 * in the query/mutation hooks and the loading-button's Reanimated internals,
 * so we assert architectural markers instead of rendering. Covers the
 * required testIDs, the "location is reassurance never a gate" rule (no
 * permission check, no schedule-window gate on clock-in), and the
 * NativeWind-on-Animated.View gotcha (GOLDEN-FIXES #2) not applying because
 * no Animated.View is used here at all.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/ClockInCard.tsx');
let cardSource: string;
/** Whitespace-collapsed copy — assert intent, not Biome line breaks. */
let flat: string;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  flat = cardSource.replace(/\s+/g, ' ');
});

describe('ClockInCard', () => {
  it('wires the required testIDs', () => {
    expect(cardSource).toContain('today-clock-in');
    expect(cardSource).toContain('today-clock-out');
    expect(cardSource).toContain('today-live-timer');
  });

  it('never gates clock-in on a location permission', () => {
    expect(cardSource).not.toMatch(/requestForegroundPermissions|Location\./);
  });

  it('never disables clock-in based on the scheduled shift window', () => {
    expect(cardSource).not.toMatch(/isWithinSchedule|scheduledWindow/);
  });

  it('uses the live-timer hook rather than a bare setInterval inline', () => {
    expect(cardSource).toContain('useElapsedTimer');
    expect(cardSource).not.toMatch(/setInterval\(/);
  });

  it('does not use an Animated.View for the timer (no className gotcha to avoid)', () => {
    expect(cardSource).not.toMatch(/<Animated\.View/);
  });

  // Wave 2-A: invert the idle card — "Not on the clock" drops to a
  // MetadataLabel eyebrow, and the day's own fact (the shift window, or its
  // absence) becomes the H3 headline. The window is the fact; the clock
  // state is the label.
  it('drops "Not on the clock" to a MetadataLabel eyebrow, not a title', () => {
    expect(cardSource).toMatch(
      /<MetadataLabel[^>]*>\s*\{t\('notOnTheClock'\)\}\s*<\/MetadataLabel>/
    );
    expect(cardSource).not.toContain("<H4>{t('notOnTheClock')}</H4>");
  });

  it("promotes the day's fact (shift window / none) to H3", () => {
    expect(cardSource).toContain('testID="today-off-clock-scheduled"');
    expect(cardSource).toMatch(/<H3\s+testID="today-off-clock-scheduled"/);
    expect(cardSource).toMatch(/<H3\s+testID="today-off-clock-arriving"/);
    expect(cardSource).toMatch(/<H3\s+testID="today-off-clock-none"/);
  });

  // Review fix: the H3 hero must never be a negation ("Nothing on the
  // schedule…") — that's the same "Not on the clock" eyebrow said twice.
  // `parentNoCoverBody` stays NannyLiveStatusCard's key (parent-facing,
  // negation is fine there); ClockInCard's own no-shift H3 gets an
  // invitation instead, pinned here so it can't regress back.
  it('never uses the negation copy for its own no-shift H3', () => {
    expect(cardSource).toMatch(
      /<H3 testID="today-off-clock-none">\{t\('readyWhenYouAre'\)\}<\/H3>/
    );
    expect(cardSource).not.toContain(
      '<H3 testID="today-off-clock-none">{t(\'parentNoCoverBody\')}</H3>'
    );
  });

  // The button grows once it is the one clear thing to do on the card, and
  // the reassurance line moves below it — reassurance goes after the
  // action, not in front of it.
  it('sizes the clock-in button lg and moves clockInHint below it', () => {
    expect(cardSource).toMatch(/testID="today-clock-in"[\s\S]{0,200}size="lg"/);
    const clockInIndex = cardSource.indexOf('testID="today-clock-in"');
    const hintIndex = cardSource.indexOf("t('clockInHint')");
    expect(clockInIndex).toBeGreaterThan(-1);
    expect(hintIndex).toBeGreaterThan(clockInIndex);
  });

  // Review fix: with no shift today, the absence and the hint were two long
  // lines plus a dead gap — fold them into one line rather than showing
  // both `readyWhenYouAre`'s H3 body AND the generic `clockInHint`.
  it('shows one folded hint line (not the generic clockInHint) under the button when there is no shift', () => {
    expect(cardSource).toContain("t('clockInHintNoShift')");
  });

  // Overdue is a meaning change ("please close this out", not "working") —
  // the card itself flips tone, not just the button variant, and drops the
  // apricot live dot (that signal now belongs to tone="live" only).
  it('flips the card to tone="attention" (not just the button) when overdue', () => {
    expect(cardSource).toMatch(/overdue\s*\?\s*'attention'/);
    expect(cardSource).not.toContain('live={Boolean(entry)}');
  });

  // The question here is "is this shift on HER schedule / can she clock into
  // it", not "does it cover the children" — so `pending` still counts (D-22).
  it('filters off-clock shifts with SCHEDULED_SHIFT_STATUSES, not a hand-rolled cancelled check', () => {
    expect(cardSource).toContain('SCHEDULED_SHIFT_STATUSES');
    expect(cardSource).toContain('SCHEDULED_STATUS_SET');
    expect(cardSource).not.toMatch(/s\.status !== 'cancelled'/);
  });

  it('waits for the shifts query to settle before claiming a schedule state', () => {
    expect(cardSource).toContain('shiftsSettled');
    expect(cardSource).toMatch(/shifts\.isSuccess \|\| shifts\.isError/);
  });

  it('names a declined-today shift without gating clock-in', () => {
    expect(cardSource).toContain('testID="today-off-clock-declined"');
    expect(cardSource).toContain("t('declinedToday'");
    expect(cardSource).toContain("t('declinedTodayHint')");
    expect(cardSource).not.toMatch(/disabled=\{[^}]*offClockShift/);
  });

  it('keeps clock-in isLoading tied only to clockIn.isPending and running.isLoading', () => {
    expect(cardSource).toMatch(
      /isLoading=\{clockIn\.isPending \|\| running\.isLoading\}/
    );
    expect(cardSource).not.toMatch(
      /testID="today-clock-in"[\s\S]{0,400}sendRunningLate\.isPending/
    );
  });

  // Rule M: the running-late-sent line and clock-in hint sit outside the
  // receiptEntry ternary, so they also render on tone="positive"
  // (surfacePositive). mutedStrong there; mutedForeground on plain default.
  // A blanket swap would break the default-tone off-clock card.
  it('hoists card tone and tones the two Smalls that share the receipt ground', () => {
    expect(cardSource).toMatch(
      /const tone =\s*overdue\s*\?\s*'attention'\s*:\s*entry\s*\?\s*'live'\s*:\s*receiptEntry\s*\?\s*'positive'\s*:\s*'default'/
    );
    expect(cardSource).toMatch(/tone=\{tone\}/);

    expect(flat).toMatch(
      /testID="today-running-late-sent"[\s\S]{0,200}tone === 'positive' \? 'text-muted-strong' : 'text-muted-foreground'/
    );

    // Hint Small (no testID) — anchored by the offClockShift branch that follows.
    expect(flat).toMatch(
      /<Small className=\{\s?tone === 'positive' \? 'text-muted-strong' : 'text-muted-foreground'\s?\}[\s\S]{0,20}\{offClockShift\.kind === 'none'/
    );

    // Leave the non-receipt off-clock labels alone — they only paint on
    // tone="default" plain card, where mutedForeground is correct.
    expect(cardSource).toMatch(
      /<MetadataLabel className="text-muted-foreground">\s*\{t\('notOnTheClock'\)\}/
    );
    expect(cardSource).toMatch(
      /testID="today-shift-meta"\s+className="text-muted-foreground"/
    );
    expect(cardSource).toMatch(
      /testID="today-off-clock-declined-secondary"\s+className="text-muted-foreground"/
    );
  });
});
