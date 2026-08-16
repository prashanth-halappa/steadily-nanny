/**
 * @module domains/today/hooks/useTermsGate
 *
 * A1's hard block, as a single question: may THIS nanny clock in in THIS
 * household yet? The server is the actual guard — `clockIn`,
 * `createRetroactiveEntry` and `updateEntry` all 409 with
 * `metadata.reason === 'TERMS_NOT_AGREED'` until an arrangement exists — and
 * this hook exists so the app can say so BEFORE she taps, in words that name
 * who owes the move.
 *
 * TWO RULES, both about being wrong in the safe direction:
 *
 *  - `blocked` ⇔ the arrangement query SETTLED with `null`. Pending is
 *    `loading`, never `blocked`: a card that announces a work stoppage while
 *    a request is still in flight would do so on roughly every cold start.
 *  - An ERROR resolves to `open`. FAIL OPEN. A dropped connection must never
 *    look like a work stoppage, and the cost of being wrong this way is a
 *    refused tap with an honest error, while the cost of being wrong the
 *    other way is telling a nanny standing in someone's hallway that she may
 *    not start work.
 *
 * The VARIANT comes off the open proposal's `direction` — `parent` means the
 * family sent terms and she can unblock herself in one tap; `carer` means she
 * sent them and the family is the bottleneck; nothing open means nobody has
 * started. A blocked state that does not name its owner reads as the app
 * blaming her, which is the one thing this card may not do.
 */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  findOpenTermsProposal,
  useTermsProposals,
} from '@/src/hooks/queries/useTermsProposals';
import { useAuthStore } from '@/src/store/auth';

export type TermsGateVariant = 'familySent' | 'youSent' | 'nothingSent';

export interface TermsGate {
  status: 'loading' | 'open' | 'blocked';
  /** Set only when `status === 'blocked'` — who owes the next move. */
  variant?: TermsGateVariant;
  /** The open round, when there is one — the review screen's target. */
  proposal: TermsProposal | null;
  /** The family's name, for copy. `''` when the household has none yet. */
  familyName: string;
}

export function useTermsGate(
  householdId: string | null | undefined
): TermsGate {
  const me = useAuthStore(s => s.session?.user?.id ?? null);
  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const activeNanny =
    onboarding.role === SETUP_ROLES.NANNY && !onboarding.isPastMember;
  // `null`, not `me`, for anyone else: `isValidId` refuses it, so neither
  // query fires. A parent must never issue a per-carer pay read against
  // their own user id just to be told "open" a line later.
  const carerId = activeNanny ? me : null;

  const arrangement = useCurrentPayArrangement(householdId ?? null, carerId);
  const proposals = useTermsProposals(householdId ?? null, carerId);

  const familyName =
    (active.household?.id === householdId
      ? active.household?.name
      : active.households.find(h => h.id === householdId)?.name) ?? '';
  const open = findOpenTermsProposal(proposals.data) ?? null;

  if (!activeNanny) return { status: 'open', proposal: null, familyName };
  // FAIL OPEN — see the module doc. Checked before the settled tests below,
  // so an errored query can never fall through to `loading` and pin the
  // screen on a spinner either.
  if (arrangement.isError || proposals.isError) {
    return { status: 'open', proposal: open, familyName };
  }
  if (!arrangement.isSuccess || !proposals.isSuccess) {
    return { status: 'loading', proposal: open, familyName };
  }
  if (arrangement.data) return { status: 'open', proposal: open, familyName };

  return {
    status: 'blocked',
    variant:
      open?.direction === 'parent'
        ? 'familySent'
        : open?.direction === 'carer'
          ? 'youSent'
          : 'nothingSent',
    proposal: open,
    familyName,
  };
}
