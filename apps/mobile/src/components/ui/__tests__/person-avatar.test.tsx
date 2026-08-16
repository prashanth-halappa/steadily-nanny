/**
 * @module PersonAvatarTests
 *
 * TDD tests for PersonAvatar. Load-bearing case: deriving the initial must
 * not crash on an empty string or a whitespace-only name.
 */

import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { palette } from '@/lib/design-tokens/palette';
import { colourForName, PersonAvatar } from '../person-avatar';

const CATEGORY_ACCENTS = [
  palette.light.categoryAccent1.hex,
  palette.light.categoryAccent2.hex,
  palette.light.categoryAccent3.hex,
] as const;

describe('PersonAvatar', () => {
  it('renders the uppercase first initial of the name', () => {
    const { getByText } = render(<PersonAvatar name="dana" testID="avatar" />);
    expect(getByText('D')).toBeTruthy();
  });

  it('renders with a custom testID', () => {
    const { getByTestId } = render(
      <PersonAvatar name="Dana" testID="avatar-dana" />
    );
    expect(getByTestId('avatar-dana')).toBeTruthy();
  });

  it('does not crash on an empty name and renders a fallback glyph', () => {
    const { getByTestId, getByText } = render(
      <PersonAvatar name="" testID="avatar-empty" />
    );
    expect(getByTestId('avatar-empty')).toBeTruthy();
    expect(getByText('?')).toBeTruthy();
  });

  it('does not crash on a whitespace-only name and renders a fallback glyph', () => {
    const { getByTestId, getByText } = render(
      <PersonAvatar name="   " testID="avatar-blank" />
    );
    expect(getByTestId('avatar-blank')).toBeTruthy();
    expect(getByText('?')).toBeTruthy();
  });

  it('applies a caller-provided colour as an inline style, not a literal class', () => {
    const { getByTestId } = render(
      <PersonAvatar name="Dana" colour="#6366F1" testID="avatar-colour" />
    );
    const avatar = getByTestId('avatar-colour');
    // Legacy brand swatches remap to Daylight category accents
    expect(avatar.props.style).toEqual(
      expect.objectContaining({ backgroundColor: '#6A4C77' })
    );
  });

  it('defaults to size md', () => {
    const { getByTestId } = render(
      <PersonAvatar name="Dana" testID="avatar-default-size" />
    );
    expect(getByTestId('avatar-default-size').props.className).toContain(
      'h-touch'
    );
  });

  it('supports sm and lg sizes', () => {
    const { getByTestId: getSm } = render(
      <PersonAvatar name="Dana" size="sm" testID="avatar-sm" />
    );
    expect(getSm('avatar-sm').props.className).toContain('h-8');

    const { getByTestId: getLg } = render(
      <PersonAvatar name="Dana" size="lg" testID="avatar-lg" />
    );
    expect(getLg('avatar-lg').props.className).toContain('h-16');
  });

  it('uses a caller-supplied colour in preference to the name hash', () => {
    const hashed = colourForName('Dana');
    const { getByTestId } = render(
      <PersonAvatar name="Dana" colour="#112233" testID="avatar-override" />
    );
    expect(getByTestId('avatar-override').props.style).toEqual(
      expect.objectContaining({ backgroundColor: '#112233' })
    );
    expect(hashed).not.toBe('#112233');
  });

  it('gives the same name the same accent every time', () => {
    expect(colourForName('Priya')).toBe(colourForName('Priya'));
    const first = render(<PersonAvatar name="Priya" testID="avatar-hash-a" />);
    const second = render(<PersonAvatar name="Priya" testID="avatar-hash-b" />);
    expect(first.getByTestId('avatar-hash-a').props.style).toEqual(
      expect.objectContaining({ backgroundColor: colourForName('Priya') })
    );
    expect(second.getByTestId('avatar-hash-b').props.style).toEqual(
      first.getByTestId('avatar-hash-a').props.style
    );
  });

  it('spreads a set of different names across more than one accent', () => {
    const names = [
      'Ada',
      'Ben',
      'Cara',
      'Drew',
      'Eve',
      'Finn',
      'Gia',
      'Hugo',
      'Ivy',
      'Jade',
    ];
    const used = new Set(names.map(colourForName));
    expect(used.size).toBeGreaterThan(1);
  });

  it('leaves an unnamed avatar on the muted ground', () => {
    const empty = render(<PersonAvatar name="" testID="avatar-unnamed" />);
    expect(empty.getByTestId('avatar-unnamed').props.className).toContain(
      'bg-muted'
    );
    expect(empty.getByTestId('avatar-unnamed').props.style).toBeUndefined();

    const blank = render(
      <PersonAvatar name="   " testID="avatar-unnamed-blank" />
    );
    expect(blank.getByTestId('avatar-unnamed-blank').props.className).toContain(
      'bg-muted'
    );
    expect(
      blank.getByTestId('avatar-unnamed-blank').props.style
    ).toBeUndefined();
  });

  it('only ever picks from the three category accents', () => {
    const names = [
      'Ada',
      'Ben',
      'Cara',
      'Drew',
      'Eve',
      'Finn',
      'Gia',
      'Hugo',
      'Ivy',
      'Jade',
      'Kai',
      'Lia',
      'Mo',
      'Noa',
      'Omar',
    ];
    for (const name of names) {
      expect(CATEGORY_ACCENTS).toContain(colourForName(name));
    }
  });
});
