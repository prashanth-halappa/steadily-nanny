/**
 * @module domains/timesheet/components/PaymentRow
 *
 * One recorded payment, as a ledger row. Geometry is `TimeEntryDayRow`'s
 * verbatim — `rounded-row bg-card px-4 py-3`, `elevation.row`, 56pt floor,
 * and a right-hand group of `Figure` + reserved `CHEVRON_SLOT` — so amounts
 * land in the same column down the whole list rather than depending on how
 * many sub-lines a given payment happens to have.
 *
 * L4 and nothing higher: this is a record. No tone, no border (Daylight
 * separates by light, not rule), and no apricot — apricot means someone is on
 * the clock, and a settled payment is the opposite of that.
 *
 * Presentational on purpose. Every string arrives pre-formatted and
 * pre-translated from `PaymentsScreen`, which owns the client-side join
 * against the timesheet list; a null field here means the screen had nothing
 * true to say, and the line is simply omitted rather than filled in.
 *
 * An optional leading `PersonAvatar` is the same contract: the screen names
 * a person or it does not. The avatar sits on the LEFT; the right-hand
 * `Figure` + `CHEVRON_SLOT` group is untouched, so amounts still land in
 * one column. The avatar's own accent is a name-hash, not a row tone —
 * the row stays `bg-card`.
 */
import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Figure, MetadataLabel, Small } from '@/src/components/ui/typography';
import { CHEVRON_SLOT } from './TimeEntryRow';

/** Same 56pt ledger-row floor as `TimeEntryDayRow`. */
const ROW_MIN_HEIGHT = 56;

export interface PaymentRowData {
  id: string;
  /** "Sun 16 Aug" — the settlement date, the row's headline. */
  dateLabel: string;
  amountLabel: string;
  /** `payments.rowWeek`. Null when the payment's timesheet is not in the
   * join — omitted rather than guessed. */
  weekLabel: string | null;
  /** "To Amara · Bank transfer" — either half may be absent; null when both
   * are. The "to" half never renders for a nanny reading her own record. */
  metaLabel: string | null;
  /** `payments.rowEnteredLate`. Null unless the entry trails the money by
   * more than one day. */
  enteredLateLabel: string | null;
  /** Named person this row belongs to. Null when the screen had nothing
   * true to say — a nanny with one household, a parent, an untitled draft. */
  person: { name: string } | null;
}

interface PaymentRowProps {
  row: PaymentRowData;
  onPress: () => void;
}

export function PaymentRow({ row, onPress }: PaymentRowProps) {
  const testID = `payments-row-${row.id}`;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="mb-2 rounded-row bg-card px-4 py-3"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      <View className="flex-row items-center justify-between gap-3">
        {row.person ? (
          <PersonAvatar
            name={row.person.name}
            size="sm"
            testID={`${testID}-avatar`}
          />
        ) : null}
        <View className="min-w-0 flex-1 gap-1">
          <MetadataLabel
            testID={`${testID}-date`}
            className="text-muted-foreground"
          >
            {row.dateLabel}
          </MetadataLabel>
          {row.weekLabel ? (
            <Small testID={`${testID}-week`} className="text-muted-foreground">
              {row.weekLabel}
            </Small>
          ) : null}
          {row.metaLabel ? (
            <Small testID={`${testID}-meta`} className="text-muted-foreground">
              {row.metaLabel}
            </Small>
          ) : null}
          {row.enteredLateLabel ? (
            <Small testID={`${testID}-late`} className="text-muted-foreground">
              {row.enteredLateLabel}
            </Small>
          ) : null}
        </View>
        {/* Mirrors TimeEntryDayRow's right-hand group exactly — figure, 8px
            gap, reserved chevron slot. */}
        <View className="flex-shrink-0 flex-row items-center gap-2">
          <Figure testID={`${testID}-amount`} weight="medium">
            {row.amountLabel}
          </Figure>
          <View style={{ width: CHEVRON_SLOT }}>
            <Icon
              icon={ChevronRight}
              size={CHEVRON_SLOT}
              className="text-muted-foreground"
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
