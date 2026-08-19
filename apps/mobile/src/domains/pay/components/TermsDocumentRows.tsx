/**
 * @module domains/pay/components/TermsDocumentRows
 *
 * The body of the ONE terms document (`screens-pay-terms.md` §2), rendered
 * identically wherever the agreement is read: the parent's Pay & terms card,
 * the nanny's My pay card, and 3-O's proposal review
 * (`screens-onboarding-terms-proposal.md` §7.2).
 *
 * It exists because §7.2 requires an assertion that all three render the same
 * group keys in the same order, and the honest way to make that true is to
 * have one component rather than three loops that currently agree. Each
 * screen brings only its own testID namespace; nothing else about the rows is
 * a screen's decision.
 *
 * Only terms that are set are rendered. A `null` value means the term is
 * absent from the document entirely — a nanny sharing her terms with a family
 * should not bury three real terms under eleven lines of "Not set". The
 * filter lives here, not in `buildTermRows`, because three other consumers
 * still need the null rows: `termsDiff.ts` (a term going set→unset must still
 * diff), `PayTermsGroups.tsx` (the edit form's collapsed summaries, where
 * "Not set" is the affordance to go fill it in), and `DraftHomeScreen.tsx`
 * (the nanny's own pre-share draft). `value: ''` is not null — that is the
 * PTO-balance row while its ledger query is in flight — so it still renders
 * blank rather than popping in on resolve.
 *
 * `subLineByKey` is §7.6's diff affordance — "was $28.00/hr" under each
 * CHANGED row on a counter. It overrides the row's own second line (only the
 * PTO-balance caption has one), because on a counter the question the reader
 * has about a row is what it used to say, not how its figure was derived.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { PtoBalance } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { buildTermRows } from '../utils/termRows';
import { AmountRow } from './AmountRow';
import type { GlossaryEntryKey } from './TermsGlossarySheet';
import { TermsGlossarySheet } from './TermsGlossarySheet';

/**
 * `buildTermRows` key -> glossary entry (spec §11.3). Only rows whose term
 * has an entry appear here; every other row renders as plain, unpressable
 * text. This is the read-only document's half of the wiring — the edit form
 * (`PayTermsGroups`) and the earnings breakdown carry the other two, and
 * between them every entry but `workweek` has a door. `workweek` names a
 * concept rather than a field, so nothing here labels it.
 */
const GLOSSARY_BY_ROW_KEY: Record<string, GlossaryEntryKey> = {
  overtime: 'overtime',
  dailyOvertime: 'dailyOvertime',
  doubletime: 'doubleTime',
  seventhDay: 'seventhDay',
  guaranteedHours: 'guaranteedHours',
  pto: 'paidTimeOff',
  cancellations: 'cancellationPay',
  mileage: 'mileage',
  outsideWages: 'outsideWages',
};

export interface TermsDocumentRowsProps {
  arrangement: PayArrangement;
  /** `undefined` while the ledger query is in flight, `null` when there is
   * nothing to show — `buildTermRows`' own three-valued contract, passed
   * straight through. A proposal has no ledger and passes nothing. */
  balance?: PtoBalance | null;
  /** The screen's testID namespace: each row is `${testIDPrefix}-${key}`. */
  testIDPrefix: string;
  /** §7.6 — a second line per changed term, keyed by row key. */
  subLineByKey?: Readonly<Record<string, string>>;
}

export function TermsDocumentRows({
  arrangement,
  balance,
  testIDPrefix,
  subLineByKey,
}: TermsDocumentRowsProps) {
  const { t } = useTranslation('pay');
  const [glossaryKey, setGlossaryKey] = useState<GlossaryEntryKey | null>(null);

  return (
    <View className="gap-3">
      {buildTermRows(arrangement, t, balance)
        .filter(row => row.value !== null)
        .map(row => {
          const entry = GLOSSARY_BY_ROW_KEY[row.key];
          return (
            <AmountRow
              key={row.key}
              testID={`${testIDPrefix}-${row.key}`}
              label={row.label}
              value={row.value}
              valueWhenNull={row.valueWhenNull}
              subLine={subLineByKey?.[row.key] ?? row.subLine}
              onLabelPress={entry ? () => setGlossaryKey(entry) : undefined}
            />
          );
        })}
      {/* Mounted only when open — see EarningsBreakdownSheet for why an
          always-mounted BottomSheetBase is a hazard, not just noise. */}
      {glossaryKey !== null ? (
        <TermsGlossarySheet
          visible
          entryKey={glossaryKey}
          onDismiss={() => setGlossaryKey(null)}
        />
      ) : null}
    </View>
  );
}
