/**
 * Terms-proposal command service (CQRS-lite: writes) — D-35, D-38, D-49.
 *
 * A proposal is a MESSAGE about money, never a record OF money. Nothing this
 * module writes is priced, no timesheet can reference it, and the earnings
 * engine never sees it. The BINDING ACT is `accept`, and acceptance inserts a
 * real `pay_arrangements` row by CALLING the existing
 * `payArrangementCommandService.create` under the accepting parent's own
 * credentials — `WRITE_ROLES = {owner, parent}` is untouched and the nanny
 * never inserts an arrangement (§17). This table is how she ASKS.
 *
 * FOUR VERBS, AND WHAT EACH ONE MAY NOT DO
 *
 * - `propose` writes a new round. The author RESOLVES FROM MEMBERSHIP, never
 *   from the body: a body that could set `direction`/`carer_id`/`status` is a
 *   body that could propose as somebody else.
 * - `counter` is `propose` with `supersedes_id`. It is a NEW ROW, never an
 *   edit — that is what makes §7.2's "How we got here" a true history rather
 *   than a UI convenience.
 * - `withdraw` closes the author's OWN round. Nothing is deleted; the row
 *   stays in the history as `withdrawn` (§9.1).
 * - `markViewed` stamps a one-way receipt. It is the only write here that any
 *   reader may make, and the only one that is not a lifecycle change.
 *
 * D-49 IS A SERVICE RULE AS WELL AS AN RLS ONE. 092's carer self-arm
 * (`carer_id = auth.uid()`) is the database half of "a `candidate` nanny may
 * see, counter and withdraw her own proposal and nothing else". The
 * repositories here run as the service role and bypass RLS entirely, so the
 * gates in `utils/proposalAccess.ts` are the half that actually fires.
 *
 * @module domains/termsProposal/services/termsProposalCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { CreatePayArrangementRequestSchema } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import {
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  notifyHouseholdParents,
  notifyUser,
} from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { payArrangementCommandService } from '../../pay/services/payArrangementCommandService';
import type { CreatePayArrangementRequest } from '../../pay/types';
import { localDateOf } from '../../timesheet/utils/weekStart';
import { UserService } from '../../user';
import {
  TermsProposalNotActionableError,
  TermsProposalNotFoundError,
  TermsProposalValidationError,
} from '../errors/termsProposalErrors';
import { TermsProposalRepository } from '../repositories/termsProposalRepository';
import {
  type AcceptTermsProposalRequest,
  type CreateTermsProposalRequest,
  TERMS_PROPOSAL_DIRECTIONS,
  TERMS_PROPOSAL_STATUSES,
  type TermsProposalDirection,
  type TermsProposalRow,
} from '../schemas';
import {
  assertCanReadProposals,
  assertProposalCarer,
  type MembershipLookup,
  type MembershipRow,
  type ProposalSide,
  resolveSide,
} from '../utils/proposalAccess';

/** Injectable push seam — defaults to the fire-and-forget household helpers. */
export interface TermsProposalPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
  notifyHouseholdParents: (householdId: string, payload: PushPayload) => void;
}

/**
 * The one method `accept` needs from `payArrangementCommandService`. Narrowed
 * to a seam so a test can prove the call happens — and prove what happens
 * when it FAILS — without standing up the real pay domain. The real service
 * is the default, and it must stay the real one: a second insert path into
 * `pay_arrangements` is exactly what §17 forbids.
 */
export interface ArrangementCreator {
  create: (
    callerId: string,
    householdId: string,
    carerId: string,
    request: CreatePayArrangementRequest
  ) => Promise<{ id: string }>;
}

/**
 * §8.2.1's `candidate` -> `active` flip, as a CAS on `status = 'candidate'`.
 *
 * TODO(3-O): the default is `null` because
 * `householdMemberRepository.activateCandidate` is landing in the household
 * slice's own branch and does not exist here yet. WHEN IT MERGES, change the
 * constructor default below to `new HouseholdMemberRepository()` and delete
 * this note — until then a candidate acceptance fails LOUDLY at
 * `payArrangementCommandService`'s active-nanny assertion rather than
 * silently half-completing. Do NOT add a second activation mechanism here to
 * work around it; one CAS, one owner.
 */
export interface CandidateActivator {
  activateCandidate: (memberId: string) => Promise<unknown>;
}

/**
 * D-16's future horizon (spec §6/§7.4), mirrored from
 * `payArrangementCommandService`'s `MAX_FUTURE_MONTHS` — that module keeps
 * both the constant and its `addMonthsISO` helper private, so this is a
 * deliberate mirror rather than a reuse. The two must not drift: a proposal
 * that passes here and is refused at acceptance is the worst possible place
 * to discover a fat-fingered year, because the parent has already agreed.
 */
const MAX_FUTURE_MONTHS = 12;

/**
 * The horizon date, `months` months after `dateISO`. Same UTC-Date-rollover
 * technique as `payArrangementCommandService.addMonthsISO`, character for
 * character, so the two "how far is 12 months" answers cannot disagree.
 */
function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + months, d ?? 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Same literal as `payArrangementCommandService`'s and 033's backfill, so an
 * unnamed carer reads identically across the whole payroll record.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

export class TermsProposalCommandService {
  constructor(
    private readonly proposalRepo: TermsProposalRepository = new TermsProposalRepository(),
    private readonly members: MembershipLookup = new HouseholdMemberRepository(),
    private readonly householdRepo: Pick<
      HouseholdRepository,
      'findById'
    > = new HouseholdRepository(),
    private readonly userService: Pick<
      typeof UserService,
      'getProfileById'
    > = UserService,
    private readonly push: TermsProposalPushNotifier = {
      notifyUser,
      notifyHouseholdParents,
    },
    private readonly arrangements: ArrangementCreator = payArrangementCommandService,
    // See `CandidateActivator`'s TODO for why this default is null.
    private readonly candidates: CandidateActivator | null = null
  ) {}

  /**
   * Write a new round — a first proposal, or (with `supersedes_id`) a counter.
   *
   * `carerIdFromUrl` is IGNORED when the caller is the carer: she proposes for
   * herself and nobody else, whatever the path says. It is honoured, and
   * asserted, only on the parent side.
   *
   * `now` is injectable purely so the household-local date boundary can be
   * tested on both sides of midnight — production callers never pass it (the
   * same convention as `timesheetCommandService.clockIn`).
   */
  async propose(
    callerId: string,
    householdId: string,
    carerIdFromUrl: string,
    request: CreateTermsProposalRequest,
    now: () => Date = () => new Date()
  ): Promise<TermsProposalRow> {
    const side = await resolveSide(this.members, householdId, callerId);
    if (!side) {
      throw new TermsProposalNotFoundError({
        householdId,
        carerId: carerIdFromUrl,
        reason: 'not_on_the_proposal_write_circle',
      });
    }

    const isCarer = side.kind === 'carer';
    const carerId = isCarer ? callerId : carerIdFromUrl;
    const direction: TermsProposalDirection = isCarer
      ? TERMS_PROPOSAL_DIRECTIONS.CARER
      : TERMS_PROPOSAL_DIRECTIONS.PARENT;
    const carerMembership: MembershipRow = isCarer
      ? side.membership
      : await assertProposalCarer(this.members, householdId, carerId);

    const terms = await this.validateTerms(request.terms, householdId, now);
    const carerDisplayName = await this.resolveCarerDisplayName(
      carerId,
      carerMembership.display_name_override
    );

    // ORDER IS FORCED, NOT CHOSEN. 092's partial unique index allows at most
    // one `proposed` row per (household, carer), so inserting the counter
    // first would 23505 against the round it is answering — every time, not
    // just under a race. Flipping first is therefore the only order that can
    // ever succeed, and it also means a failure between the two leaves ZERO
    // open rounds rather than two: the negotiation is answerable again with
    // one more tap, which is the recoverable direction to fail in.
    if (request.supersedes_id) {
      await this.counterPriorRound(
        request.supersedes_id,
        householdId,
        carerId,
        now
      );
    }

    const created = await this.proposalRepo.create({
      household_id: householdId,
      carer_id: carerId,
      proposed_by: callerId,
      direction,
      terms,
      note: request.note ?? null,
      supersedes_id: request.supersedes_id ?? null,
      // Set only by 094's redemption function, which CLONES a draft proposal
      // into the target household (D-38). An in-household proposal has no
      // invite behind it (§9).
      from_invite_id: null,
      carer_display_name: carerDisplayName,
    });

    this.notifyOfNewRound(created);
    return created;
  }

  /**
   * §7.3 — THE BINDING ACT. Parents/owner only, on a `proposed` round only.
   *
   * ORDER, AND WHY IT DIFFERS FROM THE SPEC'S PROSE. §7.3 lists the
   * arrangement insert first and the `candidate` -> `active` flip last. That
   * order cannot work against the service it is required to call:
   * `payArrangementCommandService.create` asserts the carer is an ACTIVE
   * nanny (its gate 2, the D12-class assertion) and a candidate matches no
   * `status = 'active'` predicate anywhere — so an acceptance in the
   * nanny-first flow, which is the flow this whole feature exists for, would
   * fail on its own first step. §8.2.1's own wording is the reconciliation:
   * "acceptance flips candidate -> active IN THE SAME TRANSACTION that
   * inserts the arrangement", and within one transaction the flip must
   * precede the assertion that reads it.
   *
   * The residual cost, stated rather than hidden: if the arrangement insert
   * fails after the flip, the carer is an active member of a household with
   * no agreed terms. That is not a corrupt state — it is exactly the state a
   * parent-first household is in before anyone sets a rate, and
   * `docs/11-MONEY.md` §4 already renders it as "no rate set" rather than
   * £0.00. The PROPOSAL, which is the thing this spec promises stays
   * recoverable, is untouched: it is still `proposed` and retry is one tap
   * (§12).
   */
  async accept(
    callerId: string,
    proposalId: string,
    request: AcceptTermsProposalRequest,
    now: () => Date = () => new Date()
  ): Promise<TermsProposalRow> {
    const { proposal, side } = await this.loadAnswerableForCaller(
      callerId,
      proposalId
    );
    const { household_id: householdId, carer_id: carerId } = proposal;
    if (side.kind !== 'parent') {
      // A nanny accepting her OWN proposal lands here, and must: acceptance
      // is what turns an ask into money, and §17 keeps that on the family's
      // side of the table.
      throw new TermsProposalNotFoundError({
        proposalId,
        reason: 'acceptance_is_the_family_side',
      });
    }

    const carerMembership = await assertProposalCarer(
      this.members,
      householdId,
      carerId
    );

    // See the method doc: this must precede the arrangement insert, and it is
    // a CAS on `status = 'candidate'`, so an already-active nanny no-ops.
    await this.candidates?.activateCandidate(carerMembership.id);

    // The ONE insert path into `pay_arrangements` (§17). The proposal is
    // stamped only AFTER this returns — if it throws, the row stays
    // `proposed` and nothing about the negotiation has changed.
    const arrangement = await this.arrangements.create(
      callerId,
      householdId,
      carerId,
      proposal.terms
    );

    const accepted = await this.proposalRepo.resolve(proposalId, {
      status: TERMS_PROPOSAL_STATUSES.ACCEPTED,
      responded_at: now().toISOString(),
      accepted_by: callerId,
      accepted_arrangement_id: arrangement.id,
      // D-7's checkbox, recorded ON the acceptance. The wire schema is
      // `z.literal(true)`, so this can only ever be true — writing it from
      // the request rather than as a literal keeps the record honest about
      // where the value came from.
      responsibility_confirmed: request.responsibility_confirmed,
    });
    if (!accepted) {
      throw new TermsProposalNotActionableError(proposalId, 'lost_race');
    }

    this.notifyCarerOfAcceptance(accepted);
    return accepted;
  }

  /**
   * §9.1 — the author pulls her own open round. `proposed` -> `withdrawn`,
   * plus the date. NOTHING IS DELETED: the row stays in the history with the
   * `cancelled` pill, because a history that quietly omitted the round
   * somebody pulled is an edited record, which is the one thing this feature
   * exists to make impossible.
   */
  async withdraw(
    callerId: string,
    proposalId: string,
    now: () => Date = () => new Date()
  ): Promise<TermsProposalRow> {
    const { proposal } = await this.loadAnswerableForCaller(
      callerId,
      proposalId
    );
    if (proposal.proposed_by !== callerId) {
      // The other side ANSWERS a round (counter or accept); it never pulls
      // one. Same opaque 404 as a stray id — a caller learns nothing about
      // who authored what.
      throw new TermsProposalNotFoundError({
        proposalId,
        reason: 'not_the_author',
      });
    }

    const withdrawn = await this.proposalRepo.resolve(proposalId, {
      status: TERMS_PROPOSAL_STATUSES.WITHDRAWN,
      responded_at: now().toISOString(),
    });
    if (!withdrawn) {
      throw new TermsProposalNotActionableError(proposalId, 'lost_race');
    }

    this.notifyOfWithdrawal(withdrawn);
    return withdrawn;
  }

  /**
   * §5.3's "Viewed" / §11's event 5. Stamps `viewed_at` ONCE, and only for a
   * reader who is not the author.
   *
   * WHETHER, NEVER HOW MANY TIMES. Re-reading never re-stamps (the repository
   * writes only while `viewed_at is null`), and the author re-opening her own
   * proposal never stamps at all — otherwise "Viewed" on her draft home would
   * mean "I looked at my own message", which is the opposite of the fact she
   * wants. This is a delivery receipt, not surveillance of a family's evening.
   */
  async markViewed(
    callerId: string,
    proposalId: string,
    now: () => Date = () => new Date()
  ): Promise<TermsProposalRow> {
    const { proposal } = await this.loadForCaller(callerId, proposalId);
    if (proposal.proposed_by === callerId || proposal.viewed_at) {
      return proposal;
    }
    // A concurrent stamp returns null; the first one won and its timestamp is
    // the true one, so the row we already hold is the right answer.
    return (
      (await this.proposalRepo.stampViewed(proposalId, now().toISOString())) ??
      proposal
    );
  }

  /**
   * Move the round being answered to `countered` before the new one is
   * inserted — see `propose`'s comment for why the order is forced.
   */
  private async counterPriorRound(
    priorId: string,
    householdId: string,
    carerId: string,
    now: () => Date
  ): Promise<void> {
    // The COLLECTION path, so the pair is known from the URL and the caller
    // has already passed its gate — all that is left is that the named row
    // really belongs to this negotiation and is still open. A counter aimed
    // at another family's round must read as a stray id, not as a refusal
    // that confirms the row exists.
    const prior = await this.proposalRepo.findById(priorId);
    if (
      !prior ||
      prior.household_id !== householdId ||
      prior.carer_id !== carerId
    ) {
      throw new TermsProposalNotFoundError({
        proposalId: priorId,
        householdId,
        carerId,
        reason: 'superseded_row_not_for_this_pair',
      });
    }
    if (prior.status !== TERMS_PROPOSAL_STATUSES.PROPOSED) {
      throw new TermsProposalNotActionableError(priorId, 'not_proposed', {
        status: prior.status,
      });
    }
    const countered = await this.proposalRepo.resolve(priorId, {
      status: TERMS_PROPOSAL_STATUSES.COUNTERED,
      responded_at: now().toISOString(),
    });
    if (!countered) {
      throw new TermsProposalNotActionableError(priorId, 'lost_race');
    }
  }

  /**
   * Load a proposal BY ID and gate the caller against the row's OWN
   * (household, carer) — the shape every item route needs.
   *
   * WHY THE ROW RESOLVES ITS OWN SCOPE. The item routes are
   * `/terms-proposals/:proposalId` with nothing else in the path, because the
   * review screen is reached from a push deep link carrying only
   * `data.proposalId` and §12 forbids a spinner on a screen someone opened
   * from a notification about money. A household+carer-scoped item route would
   * force a round trip before the screen could paint.
   *
   * That means the gate cannot be middleware, and it must not be:
   * GOLDEN-FIXES #32 — `makeOwnershipValidator` caches on `(user, resource)`
   * without the lookup's identity in the key, so a wide read lookup on
   * `GET /:id` and a narrow one on the actions would share one entry with a
   * process-wide one-hour TTL, and a single permitted GET would short-circuit
   * every later action's stricter check. `timesheetRoutes.ts:42-53` registers
   * its own `GET /:id` with no ownership middleware for exactly this reason.
   * The gate lives here instead, and runs on every call.
   */
  private async loadForCaller(
    callerId: string,
    proposalId: string
  ): Promise<{ proposal: TermsProposalRow; side: ProposalSide }> {
    const proposal = await this.proposalRepo.findById(proposalId);
    if (!proposal) {
      throw new TermsProposalNotFoundError({
        proposalId,
        reason: 'no_such_proposal',
      });
    }
    const side = await assertCanReadProposals(
      this.members,
      proposal.household_id,
      callerId,
      proposal.carer_id
    );
    return { proposal, side };
  }

  /** The same, and still open. A resolved round is a 409, not a 404. */
  private async loadAnswerableForCaller(
    callerId: string,
    proposalId: string
  ): Promise<{ proposal: TermsProposalRow; side: ProposalSide }> {
    const loaded = await this.loadForCaller(callerId, proposalId);
    if (loaded.proposal.status !== TERMS_PROPOSAL_STATUSES.PROPOSED) {
      throw new TermsProposalNotActionableError(proposalId, 'not_proposed', {
        status: loaded.proposal.status,
      });
    }
    return loaded;
  }

  /**
   * The `terms` payload is a full `CreatePayArrangementRequest`, and it is
   * validated HERE as well as at the wire: the wire schema guards the shape,
   * and this guards the two things the shape cannot.
   *
   * D-16's horizon is checked at PROPOSAL time and not only at acceptance,
   * because acceptance runs `payArrangementCommandService.create`, which
   * makes the identical check — and a proposal that a parent can read, agree
   * with and tap Agree on, only to be told the date is impossible, fails at
   * the single worst moment in the whole flow.
   *
   * A FUTURE `valid_from` IS NEVER CLAMPED to today to make it fit. §7.4: the
   * card would then read "in effect since 12 Aug" for terms both parties
   * agreed start on the 17th, and this app's entire pitch is that the record
   * says what was agreed.
   */
  private async validateTerms(
    terms: CreatePayArrangementRequest,
    householdId: string,
    now: () => Date
  ): Promise<CreatePayArrangementRequest> {
    const parsed = CreatePayArrangementRequestSchema.safeParse(terms);
    if (!parsed.success) {
      throw new TermsProposalValidationError('TERMS_SCHEMA_INVALID', {
        householdId,
        issues: parsed.error.issues.map(issue => issue.path.join('.')),
      });
    }

    const household = await this.householdRepo.findById(householdId);
    const today = localDateOf(now(), household?.timezone ?? 'UTC');
    const horizon = addMonthsISO(today, MAX_FUTURE_MONTHS);
    // ISO dates compare correctly as strings — both sides are YYYY-MM-DD.
    if (parsed.data.valid_from > horizon) {
      throw new TermsProposalValidationError('VALID_FROM_TOO_FAR_IN_FUTURE', {
        householdId,
        validFrom: parsed.data.valid_from,
        horizon,
      });
    }
    return parsed.data;
  }

  /**
   * Snapshot the carer's display name AT INSERT (033 discipline), never
   * derived on read: the negotiation must stay legible after her profile is
   * gone, and 092 makes the column `not null` for exactly that reason.
   * Resolution order matches the pay domain's — the household's own
   * `display_name_override` wins over the profile name, whitespace counts as
   * absent.
   */
  private async resolveCarerDisplayName(
    carerId: string,
    displayNameOverride: string | null
  ): Promise<string> {
    const override = displayNameOverride?.trim();
    if (override) return override;
    const profile = await this.userService.getProfileById(carerId);
    return profile?.name ?? UNNAMED_CARER_DISPLAY_NAME;
  }

  /**
   * N14/N15 (§13). Fire-and-forget, same discipline as every push in the pay
   * domain: a delivery failure must never fail the write that succeeded.
   *
   * NO FIGURE IN ANY BODY. This matches the deliberate omission in
   * `TIMESHEET_APPROVED` (A8): a lock screen is a public surface, and her
   * rate is the thing she most fears leaking. "Marisol proposed terms for
   * your family", never "Marisol proposed $28/hr".
   *
   * ONE TYPE PER AUDIENCE, TWO BODIES. A first round and a counter are the
   * same fact to the recipient — "the other side has said something about
   * your terms" — so the copy forks and the type does not, exactly as
   * `payArrangementCommandService.notifyCarerOfNewTerms` forks on
   * `valid_from` without minting a second type for a scheduled change.
   */
  private notifyOfNewRound(proposal: TermsProposalRow): void {
    const isCounter = proposal.supersedes_id !== null;
    try {
      if (proposal.direction === TERMS_PROPOSAL_DIRECTIONS.CARER) {
        this.push.notifyHouseholdParents(proposal.household_id, {
          title: isCounter
            ? `${proposal.carer_display_name} suggested changes to the terms`
            : `${proposal.carer_display_name} proposed terms for your family`,
          body: 'Open Steadily to review them.',
          data: this.deepLink(
            PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_RECEIVED,
            proposal
          ),
        });
        return;
      }
      this.push.notifyUser(proposal.carer_id, {
        title: isCounter
          ? 'Your terms came back with changes'
          : 'Terms were proposed for you',
        body: 'Open My pay to see what was suggested.',
        data: this.deepLink(
          PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_COUNTERED,
          proposal
        ),
      });
    } catch {
      // Both helpers are sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /** N16 (§13) — to the carer, whose terms are now real. No figure (A8). */
  private notifyCarerOfAcceptance(proposal: TermsProposalRow): void {
    try {
      this.push.notifyUser(proposal.carer_id, {
        title: 'Your terms were agreed',
        body: 'Open My pay to see what was agreed.',
        data: this.deepLink(
          PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_ACCEPTED,
          proposal
        ),
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /**
   * N17 (§13) — to the family, when the CARER pulls her round.
   *
   * A parent withdrawing his own counter pushes nothing, deliberately:
   * `terms_proposal_withdrawn` is a parent-audience type in
   * `attention-and-notifications.md`'s canonical map, there is no
   * carer-audience twin, and inventing one to cover the rarer direction would
   * put a type in the nanny's notification settings that §13 never listed.
   * She sees the change the next time she opens the screen.
   */
  private notifyOfWithdrawal(proposal: TermsProposalRow): void {
    if (proposal.direction !== TERMS_PROPOSAL_DIRECTIONS.CARER) return;
    try {
      this.push.notifyHouseholdParents(proposal.household_id, {
        title: 'A terms proposal was withdrawn',
        body: 'Open Steadily to see the record.',
        data: this.deepLink(
          PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_WITHDRAWN,
          proposal
        ),
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any throw.
    }
  }

  /**
   * The `data` bag every proposal push carries. `proposalId` AND
   * `householdId`: §13 deep-links all four types to a screen that is scoped
   * by both, and a push that names only the household drops the recipient on
   * a list instead of the thing they were told about.
   */
  private deepLink(
    type: string,
    proposal: TermsProposalRow
  ): Record<string, unknown> {
    return {
      type,
      householdId: proposal.household_id,
      proposalId: proposal.id,
    };
  }
}

// Singleton for controllers/routes that don't need DI.
export const termsProposalCommandService = new TermsProposalCommandService();
