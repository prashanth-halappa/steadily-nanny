import { describe, expect, it } from 'bun:test';
import type { User } from '@supabase/supabase-js';
import {
  buildBootstrapProfileRequest,
  deriveBootstrapName,
} from '../bootstrapUserProfile';

describe('deriveBootstrapName', () => {
  it('prefers full_name from user_metadata', () => {
    const user = {
      user_metadata: { full_name: 'Jane Doe' },
    } as unknown as User;
    expect(deriveBootstrapName(user)).toBe('Jane Doe');
  });

  it('falls back to email local-part when Apple name is absent', () => {
    const user = {
      email: 'parent@example.com',
      user_metadata: {},
    } as User;
    expect(deriveBootstrapName(user)).toBe('parent');
  });

  it('falls back to a generic label when name and email are missing', () => {
    const user = { user_metadata: {} } as User;
    expect(deriveBootstrapName(user)).toBe('User');
  });
});

describe('buildBootstrapProfileRequest', () => {
  it('includes name, placeholders, and timezone', () => {
    const req = buildBootstrapProfileRequest({
      user_metadata: { full_name: 'Sam' },
    } as unknown as User);
    expect(req.name).toBe('Sam');
    expect(req.city).toBe('—');
    expect(req.country).toBe('—');
    expect(req.timezone).toBeTruthy();
  });
});
