/**
 * @module domains/inbox/__tests__/InboxRow.household.test
 *
 * P8 — when the viewer is in more than one household, the kind overline
 * must name which household the row belongs to. Otherwise two identical
 * "Terms · …" rows look like a glitch.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';

let InboxRow: typeof import('../components/InboxRow').InboxRow;

beforeAll(async () => {
  // Interpolating mock so `kindWithHousehold({ kind, household })` is
  // observable — the global key-echo drops opts.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, string | number>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/domains/inbox/utils/inboxItemCopy', () => ({
    titleForItem: () => 'title',
    subtitleForItem: () => 'subtitle',
  }));

  InboxRow = (await import('../components/InboxRow')).InboxRow;
});

const ITEM: InboxItem = {
  kind: 'terms_ack',
  id: 'ack-1',
  householdId: 'hh-1',
  validFrom: '2026-08-01',
  isFirstTerms: false,
};

describe('InboxRow household overline (P8)', () => {
  it('names the household on the kind overline when householdName is passed', () => {
    const { getByTestId } = render(
      <InboxRow
        item={ITEM}
        isFirst={true}
        timeZone="UTC"
        householdName="The Ortiz Family"
        onPress={() => {}}
      />
    );

    expect(getByTestId('inbox-item-kind-terms_ack').props.children).toBe(
      'kindWithHousehold({"kind":"kinds.terms_ack","household":"The Ortiz Family"})'
    );
  });

  it('falls back to common:theFamily when householdName is null', () => {
    const { getByTestId } = render(
      <InboxRow
        item={ITEM}
        isFirst={true}
        timeZone="UTC"
        householdName={null}
        onPress={() => {}}
      />
    );

    expect(getByTestId('inbox-item-kind-terms_ack').props.children).toBe(
      'kindWithHousehold({"kind":"kinds.terms_ack","household":"common:theFamily"})'
    );
  });

  it('keeps the plain kind label when householdName is omitted (single-household)', () => {
    const { getByTestId } = render(
      <InboxRow item={ITEM} isFirst={true} timeZone="UTC" onPress={() => {}} />
    );

    expect(getByTestId('inbox-item-kind-terms_ack').props.children).toBe(
      'kinds.terms_ack'
    );
  });
});
