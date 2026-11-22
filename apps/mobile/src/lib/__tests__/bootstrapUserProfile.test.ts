import { describe, expect, it } from 'bun:test';
import type { AuthUser } from '@/src/lib/authClient';
import {
  buildBootstrapProfileRequest,
  deriveBootstrapName,
  deriveSeedName,
} from '../bootstrapUserProfile';

const user = (fields: Partial<AuthUser>) => fields as AuthUser;

describe('deriveBootstrapName', () => {
  it('prefers the auth user name', () => {
    expect(deriveBootstrapName(user({ name: 'Jane Doe' }))).toBe('Jane Doe');
  });

  it('falls back to email local-part when the name is blank (Better Auth stores " " for a nameless Apple user)', () => {
    expect(
      deriveBootstrapName(user({ name: ' ', email: 'parent@example.com' }))
    ).toBe('parent');
  });

  it('falls back to a generic label when name and email are missing', () => {
    expect(deriveBootstrapName(user({}))).toBe('User');
  });
});

describe('deriveSeedName', () => {
  it('never prefills the email local-part', () => {
    expect(
      deriveSeedName(user({ name: '', email: 'parent@example.com' }))
    ).toBe('');
  });

  it('prefills a name the user gave us', () => {
    expect(deriveSeedName(user({ name: ' Ana Ruiz ' }))).toBe('Ana Ruiz');
  });
});

describe('buildBootstrapProfileRequest', () => {
  it('includes name, placeholders, and timezone', () => {
    const req = buildBootstrapProfileRequest(user({ name: 'Sam' }));
    expect(req.name).toBe('Sam');
    expect(req.city).toBe('—');
    expect(req.country).toBe('—');
    expect(req.timezone).toBeTruthy();
  });
});
