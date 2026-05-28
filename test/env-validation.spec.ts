import { validateEnv } from '../src/config/env.validation';

describe('validateEnv', () => {
  it('validates required env and applies defaults', () => {
    expect(
      validateEnv({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        IOS_SHORTCUT_SECRET: 'secret',
      }),
    ).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DEFAULT_CURRENCY: 'EUR',
      DEFAULT_TIMEZONE: 'Europe/Nicosia',
    });
  });

  it('coerces PORT to number', () => {
    expect(
      validateEnv({
        PORT: '4000',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        IOS_SHORTCUT_SECRET: 'secret',
      }).PORT,
    ).toBe(4000);
  });

  it('throws for missing required values', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow('Invalid environment');
  });
});
