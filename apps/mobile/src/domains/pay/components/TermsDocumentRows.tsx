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
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { buildTermRows } from '../utils/termRows';
import { AmountRow } from './AmountRow';

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

  return (
    <View className="gap-3">
      {buildTermRows(arrangement, t, balance)
        .filter(row => row.value !== null)
        .map(row => (
          <AmountRow
            key={row.key}
            testID={`${testIDPrefix}-${row.key}`}
            label={row.label}
            value={row.value}
            valueWhenNull={row.valueWhenNull}
            subLine={subLineByKey?.[row.key] ?? row.subLine}
          />
        ))}
    </View>
  );
}
