import { describe, expect, it } from 'bun:test';
import en from '../../../../src/domains/email/i18n/en.json';
import { renderResetPasswordEmail } from '../../../../src/domains/email/templates/resetPassword';

describe('renderResetPasswordEmail', () => {
  const resetUrl = 'https://nanny.getsteadily.app/auth/reset?token=abc123';

  it('links the button to the reset url and names the app in the subject', () => {
    const { subject, html } = renderResetPasswordEmail({ resetUrl });
    expect(subject).toBe('Reset your Steadily Nanny password');
    expect(html).toContain(`href="${resetUrl}"`);
    expect(html).toContain('expires in one hour');
  });

  it('copy obeys the voice rules: no exclamation marks', () => {
    for (const value of Object.values(en.resetPassword)) {
      expect(value).not.toContain('!');
    }
  });
});
