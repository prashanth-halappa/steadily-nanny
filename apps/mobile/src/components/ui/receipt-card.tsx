/**
 * ReceiptCard — calm confirmation surface. Positive card tone, hours chip,
 * and the receipt-tier haptic owned by useMilestone so it has one owner.
 *
 * @module components/ui/receipt-card
 */

import { CircleCheck } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useMilestone } from '@/lib/animations/useMilestone';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Body, H3 } from '@/src/components/ui/typography';

export interface ReceiptCardProps {
  testID: string;
  receiptKey: string | null;
  title: string;
  body?: string;
  dots?: ReactNode;
  children?: ReactNode;
}

export function ReceiptCard({
  testID,
  receiptKey,
  title,
  body,
  dots,
  children,
}: ReceiptCardProps) {
  useMilestone('receipt', receiptKey);

  return (
    <Card testID={testID} tone="positive">
      <CardContent className="gap-3">
        <IconChip tone="brand" icon={CircleCheck} />
        <H3>{title}</H3>
        {body ? <Body>{body}</Body> : null}
        {dots}
        {children}
      </CardContent>
    </Card>
  );
}
