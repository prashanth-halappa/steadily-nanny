/**
 * The terms gate — "may a time record exist for this day?" — and the only
 * place that question is asked (direction doc §3, constraint A1).
 *
 * It lives in `pay` rather than `timesheet` because it is a fact ABOUT
 * arrangements: `PayArrangementRepository.effectiveOn` is THE resolution rule
 * for "in force on this date" (docs/11-MONEY.md §2), and the timesheet domain
 * already imports pay services by concrete path. One question, one answer, no
 * second copy of the rule at the three call sites.
 *
 * `localDate` is a household-LOCAL `YYYY-MM-DD`, never a UTC instant —
 * callers derive it with `localDateOf(instant, timezone)` from the timesheet
 * domain's `utils/weekStart`. Passing a UTC date would refuse a legitimate
 * late-evening clock-in in Auckland on the day terms started.
 *
 * @module domains/pay/services/termsGateService
 */
import { TermsNotAgreedError } from '../errors/payErrors';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';

export class TermsGateService {
  constructor(
    private readonly arrangements: Pick<
      PayArrangementRepository,
      'effectiveOn'
    > = new PayArrangementRepository()
  ) {}

  /** Throws `TermsNotAgreedError` unless terms are in force on `localDate`. */
  async assertAgreed(
    householdId: string,
    carerId: string,
    localDate: string
  ): Promise<void> {
    const inForce = await this.arrangements.effectiveOn(
      householdId,
      carerId,
      localDate
    );
    if (!inForce) {
      throw new TermsNotAgreedError(householdId, carerId);
    }
  }
}

export const termsGateService = new TermsGateService();
