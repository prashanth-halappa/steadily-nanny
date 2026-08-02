/**
 * @module domains/today/__tests__/HandoffChipsCard.test
 * Pattern B — handoff chips card (Wave F).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  chipsForPhase,
  EVENING_HANDOFF_CHIP_KEYS,
  handoffChipLabelKey,
  MORNING_HANDOFF_CHIP_KEYS,
} from '../constants/handoffChips';

const cardPath = join(__dirname, '../components/HandoffChipsCard.tsx');
const todayPath = join(__dirname, '../components/TodayScreen.tsx');
const enTodayPath = join(__dirname, '../../../i18n/locales/en/today.json');
const esTodayPath = join(__dirname, '../../../i18n/locales/es/today.json');
let cardSource: string;
let todaySource: string;
let enToday: Record<string, any>;
let esToday: Record<string, any>;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  todaySource = await Bun.file(todayPath).text();
  enToday = await Bun.file(enTodayPath).json();
  esToday = await Bun.file(esTodayPath).json();
});

describe('HandoffChipsCard source', () => {
  it('shows morning for parent and evening for nanny', () => {
    expect(cardSource).toContain('SETUP_ROLES.PARENT');
    expect(cardSource).toContain('SETUP_ROLES.NANNY');
    expect(cardSource).toContain('HANDOFF_PHASES.MORNING');
    expect(cardSource).toContain('HANDOFF_PHASES.EVENING');
    expect(cardSource).toContain('testID="handoff-chips-card"');
    expect(cardSource).toContain('testID={`handoff-submit-${phase}`}');
  });

  it('supports parent save_moment on evening notes', () => {
    expect(cardSource).toContain('save_moment');
    expect(cardSource).toContain('testID="handoff-save-moment"');
    expect(cardSource).toContain('useUpdateHandoffNote');
    expect(cardSource).toContain('useCreateHandoffNote');
  });

  it('is mounted on TodayScreen', () => {
    expect(todaySource).toContain('HandoffChipsCard');
  });

  it('REGRESSION (a): re-seeds the editor only when the real note changes, not on every render', () => {
    // The bug: `existingChips` was `note?.chips ?? []` — a BRAND-NEW array
    // literal on every render for as long as no note existed yet — and the
    // editor's `useEffect` was keyed on that array, so it re-fired
    // constantly and wiped whatever the user had just tapped. With
    // `refetchOnWindowFocus` on, merely backgrounding the app cleared the
    // in-progress selection.
    expect(cardSource).toContain('hydratedForNoteId');
    expect(cardSource).toContain('useRef');
    expect(cardSource).toMatch(
      /hydratedForNoteId\.current === noteIdentity\)\s*return;/
    );
    // The effect must NOT be keyed on the array alone any more.
    expect(cardSource).not.toMatch(
      /setSelected\(existingChips\);\s*\},\s*\[existingChips\]\)/
    );
  });

  it("REGRESSION (b): the editor binds to the CURRENT USER's own note for the phase", () => {
    // The bug: `.find(n => n.phase === ...)` took the FIRST note carrying
    // the phase regardless of author. `handoff_notes` has no unique
    // constraint on (household, local_date, phase), so with two carers,
    // carer B's editor pre-filled with carer A's chips and submitted a
    // PATCH against A's note id — a 403 that never cleared.
    expect(cardSource).toContain('currentUserId');
    expect(cardSource).toContain('useAuthStore');
    expect(cardSource).toMatch(
      /n\.phase === editorPhase && n\.author_id === currentUserId/
    );
    expect(cardSource).toContain('const existingChips = myNote?.chips ?? []');
    expect(cardSource).toContain('const existingNoteId = myNote?.id');
    // The parent's read-back of the nanny's evening recap stays UNscoped by
    // author — it is by definition somebody else's note.
    expect(cardSource).toMatch(
      /const eveningNote = useMemo\([\s\S]{0,160}n\.phase === HANDOFF_PHASES\.EVENING\s*\)/
    );
  });

  it('renders chips through i18n, never the stored value directly', () => {
    expect(cardSource).toContain('handoffChipLabelKey');
    expect(cardSource).toContain("useTranslation('today')");
    expect(cardSource).toContain('defaultValue: chip');
    // Old testID derivation from an English label is gone.
    expect(cardSource).not.toContain("chip.replace(/\\s+/g, '-')");
    expect(cardSource).toContain('testID={`handoff-chip-${phase}-${chip}`}');
  });

  it('localizes handoff chrome through today namespace keys', () => {
    expect(cardSource).toContain("t('handoff.morningTitle')");
    expect(cardSource).toContain("t('handoff.eveningTitle')");
    expect(cardSource).toContain("t('common:save')");
    expect(cardSource).toContain("t('handoff.eveningRecap')");
    expect(cardSource).toContain("t('handoff.saveAsMoment')");
    expect(cardSource).toContain("t('handoff.savedAsMoment')");
    expect(cardSource).not.toContain('Morning handoff');
    expect(cardSource).not.toContain('Evening handoff');
    expect(cardSource).not.toContain('>Save<');
    expect(cardSource).not.toContain('Evening recap from your nanny');
    expect(cardSource).not.toContain('Save as moment');
    expect(cardSource).not.toContain('Saved as moment');
  });
});

describe('handoff chip keys', () => {
  it('stores locale-independent keys, never display labels', () => {
    // The bug: the constants were English display strings ("Slept well")
    // passed straight through as `input: { chips: selected }` and
    // persisted, so translating the UI would have written Spanish into the
    // database and made every stored row unqueryable across locales.
    for (const chip of [
      ...MORNING_HANDOFF_CHIP_KEYS,
      ...EVENING_HANDOFF_CHIP_KEYS,
    ]) {
      expect(chip).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('keeps the two phases distinct and non-empty', () => {
    expect(chipsForPhase('morning')).toEqual(MORNING_HANDOFF_CHIP_KEYS);
    expect(chipsForPhase('evening')).toEqual(EVENING_HANDOFF_CHIP_KEYS);
    expect(MORNING_HANDOFF_CHIP_KEYS.length).toBeGreaterThan(0);
    expect(EVENING_HANDOFF_CHIP_KEYS.length).toBeGreaterThan(0);
  });

  it('resolves to a `today`-namespace label key', () => {
    expect(handoffChipLabelKey('slept_well')).toBe('handoff.chips.slept_well');
  });

  it('has a display string for every key in BOTH locales', () => {
    for (const chip of [
      ...MORNING_HANDOFF_CHIP_KEYS,
      ...EVENING_HANDOFF_CHIP_KEYS,
    ]) {
      expect(enToday.handoff?.chips?.[chip]).toBeTruthy();
      expect(esToday.handoff?.chips?.[chip]).toBeTruthy();
      // Spanish must actually be translated, not an English copy.
      expect(esToday.handoff.chips[chip]).not.toBe(enToday.handoff.chips[chip]);
    }
  });

  it('never persists a display label — en/es differ, so the key cannot be either', () => {
    const enLabels = Object.values(
      enToday.handoff?.chips ?? {}
    ) as unknown as string[];
    for (const chip of [
      ...MORNING_HANDOFF_CHIP_KEYS,
      ...EVENING_HANDOFF_CHIP_KEYS,
    ]) {
      expect(enLabels).not.toContain(chip as string);
    }
  });
});
