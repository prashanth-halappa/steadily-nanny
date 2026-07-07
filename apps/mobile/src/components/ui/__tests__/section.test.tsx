/**
 * Tests for the Section wrapper component.
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock typography components
mock.module('@/components/ui/typography', () => ({
  H2: ({ children, ...props }: any) => {
    const { Text } = require('react-native');
    return <Text {...props}>{children}</Text>;
  },
  MetadataLabel: ({ children, ...props }: any) => {
    const { Text } = require('react-native');
    return <Text {...props}>{children}</Text>;
  },
}));

// Mock cn utility
mock.module('~/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Section } from '../section';

describe('Section', () => {
  it('renders children correctly', () => {
    const { getByText } = render(
      <Section>
        <Text>Child content</Text>
      </Section>
    );

    expect(getByText('Child content')).toBeTruthy();
  });

  it('renders title as H2 when provided', () => {
    const { getByText } = render(
      <Section title="My Title">
        <Text>Content</Text>
      </Section>
    );

    expect(getByText('My Title')).toBeTruthy();
  });

  it('renders metadataLabel when provided', () => {
    const { getByText } = render(
      <Section metadataLabel="Label text">
        <Text>Content</Text>
      </Section>
    );

    expect(getByText('Label text')).toBeTruthy();
  });

  it('applies px-4 by default and removes it when noPadding is true', () => {
    const { getByTestId, rerender } = render(
      <Section testID="section">
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('section').props.className).toContain('px-4');

    rerender(
      <Section testID="section" noPadding>
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('section').props.className).not.toContain('px-4');
  });

  it('applies mt-8 by default and removes it when noTopMargin is true', () => {
    const { getByTestId, rerender } = render(
      <Section testID="section">
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('section').props.className).toContain('mt-8');

    rerender(
      <Section testID="section" noTopMargin>
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('section').props.className).not.toContain('mt-8');
  });

  it('uses correct gap class based on gap prop', () => {
    const { getByTestId, rerender } = render(
      <Section testID="section" gap="none">
        <Text>Content</Text>
      </Section>
    );
    expect(getByTestId('section').props.className).toContain('gap-0');

    rerender(
      <Section testID="section" gap="sm">
        <Text>Content</Text>
      </Section>
    );
    expect(getByTestId('section').props.className).toContain('gap-2');

    rerender(
      <Section testID="section" gap="md">
        <Text>Content</Text>
      </Section>
    );
    expect(getByTestId('section').props.className).toContain('gap-3');

    rerender(
      <Section testID="section" gap="lg">
        <Text>Content</Text>
      </Section>
    );
    expect(getByTestId('section').props.className).toContain('gap-4');

    // Default gap should be 'md' (gap-3)
    rerender(
      <Section testID="section">
        <Text>Content</Text>
      </Section>
    );
    expect(getByTestId('section').props.className).toContain('gap-3');
  });

  it('applies custom className', () => {
    const { getByTestId } = render(
      <Section testID="section" className="bg-red-500">
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('section').props.className).toContain('bg-red-500');
  });

  it('sets testID on outer View', () => {
    const { getByTestId } = render(
      <Section testID="my-section">
        <Text>Content</Text>
      </Section>
    );

    expect(getByTestId('my-section')).toBeTruthy();
  });
});
