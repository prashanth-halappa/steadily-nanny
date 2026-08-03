/**
 * @module PersonAvatarTests
 *
 * TDD tests for PersonAvatar. Load-bearing case: deriving the initial must
 * not crash on an empty string or a whitespace-only name.
 */

import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { PersonAvatar } from '../person-avatar';

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
});
