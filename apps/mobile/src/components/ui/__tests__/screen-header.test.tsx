/**
 * @module components/ui/__tests__/screen-header
 *
 * ScreenHeader is the hero-band primitive (Rule H): H1 title, at most one
 * context line, and at most one anchor (a figure slot or an inline title
 * action) — the shared block 27 screens used to hand-roll with drifting
 * spacing, subtitle component, and muted colour.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenHeader } from '../screen-header';
import { Figure28 } from '../typography';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

interface JsonNode {
  props?: { testID?: string };
  children?: JsonNode[] | null;
}

function containsTestId(node: unknown, testID: string): boolean {
  const json = node as JsonNode | JsonNode[] | null;
  if (!json) return false;
  if (Array.isArray(json)) {
    return json.some(child => containsTestId(child, testID));
  }
  if (json.props?.testID === testID) return true;
  return (json.children ?? []).some(child => containsTestId(child, testID));
}

describe('ScreenHeader', () => {
  it('renders the title as H1 (32/700)', () => {
    const { getByTestId } = render(
      <ScreenHeader testID="header" title="Schedule" />
    );
    const style = flattenStyle(getByTestId('header-title').props.style);
    expect(style.fontSize).toBe(32);
    expect(style.fontWeight).toBe('700');
    expect(getByTestId('header-title').props['aria-level']).toBe('1');
  });

  it('renders no context line when none is given', () => {
    const { queryByTestId } = render(
      <ScreenHeader testID="header" title="Schedule" />
    );
    expect(queryByTestId('header-context')).toBeNull();
  });

  it('renders exactly one context line when given', () => {
    const { getAllByTestId } = render(
      <ScreenHeader testID="header" title="Schedule" contextLine="This week" />
    );
    expect(getAllByTestId('header-context')).toHaveLength(1);
  });

  it('renders the context line at 14px (within the 20px cap) with text-muted-strong, never text-muted-foreground', () => {
    const { getByTestId } = render(
      <ScreenHeader testID="header" title="Schedule" contextLine="This week" />
    );
    const contextNode = getByTestId('header-context');
    const style = flattenStyle(contextNode.props.style);
    expect(style.fontSize).toBeLessThanOrEqual(20);
    expect(contextNode.props.className).toContain('text-muted-strong');
    expect(contextNode.props.className).not.toContain('text-muted-foreground');
  });

  it('never renders an anchor bolder than the title', () => {
    const { getByTestId } = render(
      <ScreenHeader
        testID="header"
        title="Hours"
        anchor={<Figure28 testID="header-anchor-figure">2h 15m</Figure28>}
      />
    );
    const titleWeight = Number(
      flattenStyle(getByTestId('header-title').props.style).fontWeight
    );
    const anchorWeight = Number(
      flattenStyle(getByTestId('header-anchor-figure').props.style).fontWeight
    );
    expect(anchorWeight).toBeLessThanOrEqual(titleWeight);
  });

  it('renders titleAction inline on the title row, not below it', () => {
    const { getByTestId, toJSON } = render(
      <ScreenHeader
        testID="header"
        title="Schedule"
        contextLine="This week"
        titleAction={<Text testID="header-title-action">Edit</Text>}
      />
    );
    const titleRow = getByTestId('header-title-row');
    expect(containsTestId(titleRow, 'header-title-action')).toBe(true);
    // The context line is a sibling of the title row, not nested inside it.
    expect(containsTestId(titleRow, 'header-context')).toBe(false);
    expect(containsTestId(toJSON(), 'header-title-action')).toBe(true);
  });

  it('renders the back button slot when given', () => {
    const { getByTestId } = render(
      <ScreenHeader
        testID="header"
        title="Schedule"
        backButton={<Text testID="header-back">Back</Text>}
      />
    );
    expect(getByTestId('header-back')).toBeTruthy();
  });

  it('omits the back button slot when not given', () => {
    const { queryByTestId } = render(
      <ScreenHeader testID="header" title="Schedule" />
    );
    expect(queryByTestId('header-back')).toBeNull();
  });

  it('renders the art slot when given, and keeps the title column flex-1', () => {
    const { getByTestId } = render(
      <ScreenHeader
        testID="header"
        title="Today"
        art={<Text testID="header-art">art</Text>}
      />
    );
    expect(getByTestId('header-art')).toBeTruthy();
    expect(getByTestId('header-title-column').props.className).toContain(
      'flex-1'
    );
  });

  it('forwards testID to the root and derives child testIDs from it', () => {
    const { getByTestId } = render(
      <ScreenHeader
        testID="my-header"
        title="Schedule"
        contextLine="This week"
      />
    );
    expect(getByTestId('my-header')).toBeTruthy();
    expect(getByTestId('my-header-title')).toBeTruthy();
    expect(getByTestId('my-header-context')).toBeTruthy();
  });
});
