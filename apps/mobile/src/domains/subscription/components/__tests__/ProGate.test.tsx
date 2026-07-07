import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useSubscriptionStore } from '@/src/store/subscriptionStore';
import { ProGate } from '../ProGate';

describe('ProGate', () => {
  it('renders the fallback for non-Pro users', () => {
    useSubscriptionStore.getState().setTier('free');
    const { queryByText } = render(
      <ProGate fallback={<Text>locked</Text>}>
        <Text>pro-only</Text>
      </ProGate>
    );
    expect(queryByText('locked')).toBeTruthy();
    expect(queryByText('pro-only')).toBeNull();
  });

  it('renders children for Pro users', () => {
    useSubscriptionStore.getState().setTier('pro');
    const { queryByText } = render(
      <ProGate fallback={<Text>locked</Text>}>
        <Text>pro-only</Text>
      </ProGate>
    );
    expect(queryByText('pro-only')).toBeTruthy();
  });
});
