/**
 * @module domains/pay/components/PayChangeSheet
 *
 * "Change terms" — the required core (currency, rate, effective date,
 * cancellation choice) always open at the top, every optional term behind a
 * `TermGroup` (`PayTermsGroups`, D-3). D-16 replaced the old no-future-dates
 * rule: a scheduled change is the ordinary case now, bounded at 12 months out
 * instead of at today.
 *
 * Sheet-owns-values, screen-owns-mutation (the `ClockOutSheet` discipline,
 * `NannyWeekView.tsx`'s `handleSaveCorrection`): this component only builds
 * and reports a `CreatePayArrangementRequest` via `onSubmit`; the caller
 * decides whether to close the sheet, and only does so on success — a
 * refusal (a bad value, a network error) leaves every typed field intact so
 * the parent doesn't have to retype the whole form.
 *
 * **One state object, not twenty-five `useState`s.** Every field lives in a
 * single `PayTermsFormState` so the whole form can be handed to
 * `PayTermsGroups` (and re-seeded) as one value. The alternative — a setter
 * per field, threaded through a shared groups component — is how a new column
 * gets added to one screen and forgotten on the other, which is playbook T17's
 * exact failure mode.
 *
 * SIMPLIFICATION (documented, not silent): the spec's backdating hint is meant
 * to appear "only when a past date is chosen and the affected week is already
 * approved". No hook here knows whether that week is approved, so
 * `EffectiveDateField` renders the hint on any past date — a wider net, never
 * a wrong one (an unapproved week just recomputes silently, which makes the
 * hint inapplicable rather than misleading).
 */

import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Card } from '@/src/components/ui/card';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import {
  currencySymbol,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import {
  blankPayTermsFormState,
  buildCreatePayArrangementRequest,
  isWeekStartDay,
  type PayTermsFormState,
  seedPayTermsFormState,
} from '../utils/payArrangementForm';
import {
  buildTermsChangeConsequence,
  buildTermsDiff,
} from '../utils/termsDiff';
import { CancellationTermField } from './CancellationTermField';
import { CurrencySelect } from './CurrencySelect';
import { EffectiveDateField } from './EffectiveDateField';
import { PayScheduleFields } from './PayScheduleFields';
import { PayTermsGroups } from './PayTermsGroups';

interface PayChangeSheetProps {
  /**
   * `change` is a parent writing a new arrangement over an existing one.
   * `propose` is 3-O's terms proposal — the SAME form, which is the whole
   * point (`screens-pay-terms.md` §4: "Setup, change, and 3-O's nanny
   * proposal are one form rendered in three modes"). Had 3-O grown a second
   * terms form, the two surfaces would have drifted on wording inside a
   * release. The mode changes the header, the submit label, and whether the
   * consequence card renders. Nothing else.
   *
   * `offer` is P8: a parent stating pay terms on an invite BEFORE a nanny
   * exists to hang a real arrangement on. No counterparty name (nobody has
   * been hired), no supersede/consequence framing (there is nothing to diff
   * against) — just the first statement of terms.
   */
  mode?: 'change' | 'propose' | 'offer';
  /** Who will read this. Named in `propose`'s subtitle, and — since P1 —
   * in `change`'s submit label too: the button says who the terms go to,
   * because they are now a round that side has to agree to. */
  counterpartyName?: string;
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreatePayArrangementRequest) => void;
  isSubmitting: boolean;
  /** The last submit's refusal, stated INSIDE the sheet: a toast (or an
   * inline error behind it) is not visible under an open BottomSheetBase
   * (GOLDEN-FIXES #40). */
  submitError?: string | null;
  /** The sheet usually adjusts an existing arrangement. Fields seed from
   * this; OMIT IT and the form seeds blank from `defaultCurrency` instead,
   * in ANY mode. Two callers rely on the blank branch: `mode="offer"` with no
   * prior offer yet (an offer editing a PRIOR offer still passes one — see
   * `offerRequestToArrangementStub`), and A1's `ClockInBlockedCard`, whose
   * `nothingSent` variant proposes terms for a carer who has no arrangement
   * at all — that absence IS the block. The branch is keyed on
   * `!currentArrangement`, never on the mode: "there is nothing to seed from"
   * is a fact about the data, not about which button was pressed. */
  currentArrangement?: PayArrangement;
  /** Read only when `currentArrangement` is absent: the currency a blank form
   * seeds with (the household's, not the device's — same reasoning as
   * `PaySetupScreen`'s device-currency prefill). */
  defaultCurrency?: string;
  /** For the cancellation-hours default when the current arrangement has no
   * per-nanny window set — the household's fallback column. */
  householdCancellationDefaultHours: number;
  /** Household-local today, "yyyy-mm-dd" — injectable for tests. Seeds the
   * date field and bounds the backdating hint and the 12-month horizon; the
   * ACTUAL submitted date is recomputed fresh at submit time from
   * `householdTimezone` when the parent left it untouched (review finding 11
   * — see `handleSubmit`). */
  todayISO: string;
  /** IANA timezone — recomputes "today" at submit time so a sheet left open
   * across midnight never submits a stale date (review finding 11). */
  householdTimezone: string;
  /**
   * The date the form OPENS on, when it should not be today: a counter
   * pre-fills the start date the other side proposed, so answering a
   * Monday-start offer on a Friday does not silently move the start to
   * Friday. Omitted, the field seeds to `todayISO` as it always did.
   *
   * Honoured on the BLANK branch too, not only when seeding from an
   * arrangement — `ClockInBlockedCard` has no arrangement to seed from and
   * still needs to open on the nanny's first day (1.6).
   */
  initialEffectiveDateISO?: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday). Decides which
   * effective dates split a week, and so whether §7.3's consequence card
   * shows — a Monday literal would warn a Sunday-start household on exactly
   * the wrong day. */
  householdWeekStartsOn: number;
}

export function PayChangeSheet({
  mode = 'change',
  counterpartyName,
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  submitError = null,
  currentArrangement,
  defaultCurrency,
  householdCancellationDefaultHours,
  todayISO,
  initialEffectiveDateISO,
  householdTimezone,
  householdWeekStartsOn,
}: PayChangeSheetProps) {
  const { t } = useTranslation('pay');
  // The offer's copy lives in `household.json` (the invite-offer card's
  // namespace), never `pay.json` — a household-namespace `t` alongside the
  // pay one, same multi-namespace shape `PaySetupScreen` already uses.
  const { t: tHousehold } = useTranslation('household');
  const proposing = mode === 'propose';
  const offering = mode === 'offer';
  const testIDPrefix = offering
    ? 'pay-offer'
    : proposing
      ? 'pay-propose'
      : 'pay-change';
  // Literal `t()` calls per branch — see `AcceptTermsSheet` for why a ternary
  // INSIDE `t(...)` hides the second key from the locale-key guard.
  const title = offering
    ? tHousehold('invite.offer.sheetTitle')
    : proposing
      ? t('proposeSheet.title')
      : t('changeSheet.title');
  const submitLabel = offering
    ? tHousehold('invite.offer.submitButton')
    : proposing
      ? t('proposeSheet.submitButton')
      : t('changeSheet.submitButton', { name: counterpartyName ?? '' });

  // Seeded from the arrangement, NOT `getDeviceCurrency()`: an existing
  // arrangement's currency is a stored fact about the employment, and the
  // device of whoever opens this sheet says nothing about it.
  const [form, setForm] = useState<PayTermsFormState>(() =>
    currentArrangement
      ? seedPayTermsFormState(
          currentArrangement,
          householdCancellationDefaultHours,
          todayISO,
          initialEffectiveDateISO
        )
      : blankPayTermsFormState(
          defaultCurrency ?? 'USD',
          todayISO,
          initialEffectiveDateISO
        )
  );
  const patch = (next: Partial<PayTermsFormState>) =>
    setForm(current => ({ ...current, ...next }));

  // A ref, not a dependency: the seeding effect below needs today's date but
  // must NOT re-run when it changes. A sheet left open across midnight that
  // re-seeded itself would wipe a half-typed form under the parent — the
  // submitted date is recomputed in `handleSubmit` instead (review finding 11).
  const todayRef = useRef(todayISO);
  todayRef.current = todayISO;

  // Re-seed every time the sheet opens, from the CURRENT arrangement — a
  // "change" usually adjusts one term, so starting from what's already
  // agreed is friendlier than a blank form. Mirrors ClockOutSheet's
  // re-seed-on-`visible` pattern (it stays mounted between openings).
  useEffect(() => {
    if (!visible) return;
    setForm(
      currentArrangement
        ? seedPayTermsFormState(
            currentArrangement,
            householdCancellationDefaultHours,
            todayRef.current,
            initialEffectiveDateISO
          )
        : blankPayTermsFormState(
            defaultCurrency ?? 'USD',
            todayRef.current,
            initialEffectiveDateISO
          )
    );
  }, [
    visible,
    currentArrangement,
    householdCancellationDefaultHours,
    initialEffectiveDateISO,
    defaultCurrency,
  ]);

  // Render-time only — drives the submit button's enabled state. This value
  // must NOT be what gets submitted (review finding 11).
  const request = buildCreatePayArrangementRequest(form);

  // T11 / §7.3: a sentence per CHANGED term, from the same `buildTermsDiff`
  // the version history renders — one function, so the history can never
  // describe a change differently from how it was reviewed (§8.5).
  // A proposal prices NOTHING — it is a message about money, never a record
  // of it — and an offer has no PRIOR arrangement to diff against at all —
  // so the consequence card has nothing true to say in either mode.
  const consequences =
    request && mode === 'change' && currentArrangement
      ? buildTermsChangeConsequence(
          buildTermsDiff(
            currentArrangement,
            {
              ...currentArrangement,
              ...request,
              currency: request.currency ?? currentArrangement.currency,
              note: request.note ?? null,
            },
            t
          ),
          isWeekStartDay(form.effectiveDateISO, householdWeekStartsOn)
        )
      : [];

  const handleSubmit = () => {
    // Recomputed HERE, not read from the `todayISO` prop closed over at
    // render time: a sheet left open across midnight must submit today's
    // real date, not whatever "today" was when it was opened (review
    // finding 11). Only the UNTOUCHED default moves — a date the parent
    // typed is theirs, whatever the clock did since.
    const submitTodayISO = localDateInZone(householdTimezone);
    const submitRequest = buildCreatePayArrangementRequest({
      ...form,
      effectiveDateISO:
        form.effectiveDateISO === todayISO
          ? submitTodayISO
          : form.effectiveDateISO,
      todayISO: submitTodayISO,
    });
    if (!submitRequest) return;
    onSubmit(submitRequest);
  };

  return (
    <BottomSheetBase
      sheetId={testIDPrefix}
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testIDPrefix}-sheet`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{title}</H4>
        {proposing ? (
          <Small testID="pay-propose-subtitle" className="text-muted-strong">
            {t('proposeSheet.subtitle', { name: counterpartyName ?? '' })}
          </Small>
        ) : null}

        <View className="gap-2">
          <Label>{t('changeSheet.currencyLabel')}</Label>
          <CurrencySelect
            value={form.currency}
            onChange={currency => patch({ currency })}
            testIDPrefix={testIDPrefix}
          />
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.rateLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID={`${testIDPrefix}-currency-prefix`}
              className="text-muted-foreground"
            >
              {currencySymbol(form.currency)}
            </Body>
            <Input
              testID={`${testIDPrefix}-rate-input`}
              accessibilityLabel={t('changeSheet.rateLabel')}
              value={form.rateText}
              onChangeText={rateText => patch({ rateText })}
              onBlur={() => {
                const minor = parseMajorToMinor(form.rateText);
                if (minor !== null) {
                  patch({ rateText: minorToMajorText(minor) });
                }
              }}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Small className="text-muted-foreground">
            {t('changeSheet.rateHint')}
          </Small>
        </View>

        <EffectiveDateField
          testIDPrefix={testIDPrefix}
          value={form.effectiveDateISO}
          onChange={effectiveDateISO => patch({ effectiveDateISO })}
          todayISO={todayISO}
        />

        {/* §7.3: every consequence sentence, stacked and never merged, on a
            tone="attention" card in mutedStrong (Rule M — mutedForeground
            fails AA on surfaceAttention). Inline, never a toast (GOLDEN #40). */}
        {consequences.length > 0 ? (
          <Card testID={`${testIDPrefix}-consequence-card`} tone="attention">
            <View className="gap-2 p-4">
              {consequences.map((consequence, index) => (
                <Small
                  key={consequence.key}
                  testID={`${testIDPrefix}-consequence-${index}`}
                  className="text-muted-strong"
                >
                  {t(consequence.key, consequence.params)}
                </Small>
              ))}
            </View>
          </Card>
        ) : null}

        <CancellationTermField
          testIDPrefix={testIDPrefix}
          choice={form.cancellationChoice}
          hoursText={form.cancellationHoursText}
          onChoiceChange={cancellationChoice => patch({ cancellationChoice })}
          onHoursChange={cancellationHoursText =>
            patch({ cancellationHoursText })
          }
        />

        <PayTermsGroups
          testIDPrefix={testIDPrefix}
          state={form}
          onChange={patch}
          seed={currentArrangement ?? null}
        />

        {/* 082's pay schedule (D-17, T7 reversal) — presentation only, not
            part of PayTermsGroups' D-3 expanders (spec §4.3 lists it as its
            own, always-visible block). */}
        <PayScheduleFields
          testIDPrefix={testIDPrefix}
          t={t}
          payFrequency={form.payFrequency}
          onPayFrequencyChange={payFrequency => patch({ payFrequency })}
          payDayOfWeekText={form.payDayOfWeekText}
          onPayDayOfWeekTextChange={payDayOfWeekText =>
            patch({ payDayOfWeekText })
          }
          payDayOfMonthText={form.payDayOfMonthText}
          onPayDayOfMonthTextChange={payDayOfMonthText =>
            patch({ payDayOfMonthText })
          }
        />

        <View className="gap-2">
          <Label>{t('changeSheet.noteLabel')}</Label>
          <Textarea
            testID={`${testIDPrefix}-note-input`}
            accessibilityLabel={t('changeSheet.noteLabel')}
            value={form.note}
            onChangeText={note => patch({ note })}
            placeholder={t('changeSheet.notePlaceholder')}
          />
        </View>

        {submitError ? (
          <Small
            testID={`${testIDPrefix}-submit-error`}
            className="text-destructive"
          >
            {submitError}
          </Small>
        ) : null}
        <LoadingButton
          testID={`${testIDPrefix}-submit`}
          label={submitLabel}
          isLoading={isSubmitting}
          disabled={!request}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}
