/**
 * @module domains/inbox/components/InboxRow
 *
 * One triage row inside the Inbox group card. Extracted from `InboxScreen`'s
 * inline map so the row is testable on its own.
 *
 * The row is FLAT by design: the group card around it owns the lift via
 * `Card`'s internal `useElevation`, and per Rule D a dense list sits in one
 * card with an inset hairline rather than one elevated card per item. That
 * is why `isFirst` exists — the card already draws the top edge, so the
 * first row must not draw a hairline over it.
 *
 * `timeZone` is a PROP, not something this row resolves. The Inbox is
 * deliberately cross-household: each row formats in its own household's
 * zone, and a row that looked the zone up itself would need the screen's
 * lookup anyway. Passing it in keeps that decision visible at the call site.
 */
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Body, MetadataLabel, Small } from '@/src/components/ui/typography';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { personOf } from '@/src/domains/inbox/utils/buildInboxItems';
import {
  subtitleForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';

export interface InboxRowProps {
  item: InboxItem;
  /** The group card draws the top edge — the first row must not repeat it. */
  isFirst: boolean;
  /** This item's OWN household zone, never one zone for the whole list. */
  timeZone: string;
  onPress: () => void;
}

export function InboxRow({ item, isFirst, timeZone, onPress }: InboxRowProps) {
  const { t } = useTranslation('inbox');
  const person = personOf(item);

  return (
    <Pressable
      testID={`inbox-item-${item.kind}-${item.id}`}
      accessibilityRole="button"
      onPress={onPress}
      className={
        isFirst
          ? 'flex-row items-center gap-3 p-4'
          : 'border-border border-t flex-row items-center gap-3 p-4'
      }
    >
      {person ? (
        <PersonAvatar
          testID={`inbox-item-avatar-${item.id}`}
          name={person.name}
          colour={person.colour}
          size="sm"
        />
      ) : null}
      <View className="min-w-0 flex-1 gap-1">
        <MetadataLabel
          testID={`inbox-item-kind-${item.kind}`}
          className="text-muted-foreground"
        >
          {t(`kinds.${item.kind}`)}
        </MetadataLabel>
        <Body weight="semibold">{titleForItem(item, t, timeZone)}</Body>
        <Small className="text-muted-foreground">
          {subtitleForItem(item, t, timeZone)}
        </Small>
      </View>
    </Pressable>
  );
}
