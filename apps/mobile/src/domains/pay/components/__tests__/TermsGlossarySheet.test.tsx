/**
 * @module domains/pay/components/__tests__/TermsGlossarySheet
 *
 * §11.3's glossary sheet: opening it with a term key renders that term's
 * title and definition. Plus the guard the WP-G brief asked for — every key
 * a pressable label may reference (`GLOSSARY_ENTRY_KEYS`, the closed union
 * every `onLabelPress` call site is typed against) resolves to a real entry
 * in `hours.json`, in both locales, with the same key set in each.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import enHours from '@/src/i18n/locales/en/hours.json';
import esHours from '@/src/i18n/locales/es/hours.json';
import { GLOSSARY_ENTRY_KEYS, TermsGlossarySheet } from '../TermsGlossarySheet';

describe('TermsGlossarySheet', () => {
  // Global react-i18next mock echoes the key (see AmountRow.test.tsx) — so
  // these assert the sheet resolved the RIGHT key for the given entry, not
  // (redundantly) that i18next itself works.
  it('renders the term and definition for the given entry key', () => {
    const { getByTestId } = render(
      <TermsGlossarySheet visible entryKey="overtime" onDismiss={() => {}} />
    );
    expect(getByTestId('terms-glossary-sheet-term').props.children).toBe(
      'glossary.entries.overtime.term'
    );
    expect(getByTestId('terms-glossary-sheet-definition').props.children).toBe(
      'glossary.entries.overtime.definition'
    );
  });

  it('renders a different entry for a different key', () => {
    const { getByTestId } = render(
      <TermsGlossarySheet visible entryKey="gross" onDismiss={() => {}} />
    );
    expect(getByTestId('terms-glossary-sheet-term').props.children).toBe(
      'glossary.entries.gross.term'
    );
  });

  it('renders no term/definition block when entryKey is null', () => {
    const { queryByTestId } = render(
      <TermsGlossarySheet visible entryKey={null} onDismiss={() => {}} />
    );
    expect(queryByTestId('terms-glossary-sheet-term')).toBeNull();
  });
});

describe('TermsGlossarySheet — glossary key guard', () => {
  const enEntries = (
    enHours as { glossary: { entries: Record<string, unknown> } }
  ).glossary.entries;
  const esEntries = (
    esHours as { glossary: { entries: Record<string, unknown> } }
  ).glossary.entries;

  it('every key a pressable label can reference resolves to a real en entry', () => {
    for (const key of GLOSSARY_ENTRY_KEYS) {
      expect(enEntries[key]).toBeTruthy();
    }
  });

  it('every key a pressable label can reference resolves to a real es entry', () => {
    for (const key of GLOSSARY_ENTRY_KEYS) {
      expect(esEntries[key]).toBeTruthy();
    }
  });

  it('en and es glossary entries expose the same key set', () => {
    expect(Object.keys(esEntries).sort()).toEqual(
      Object.keys(enEntries).sort()
    );
  });
});
