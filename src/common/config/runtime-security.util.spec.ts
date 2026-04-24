import {
  getChatbotConfirmSecret,
  getJwtSecret,
  getMessagesEncryptionSecret,
  isSwaggerEnabled,
} from './runtime-security.util';

describe('runtime security util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SWAGGER_ENABLED;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses development JWT fallback outside production', () => {
    expect(getJwtSecret(undefined)).toBe('development-only-jwt-secret');
  });

  it('rejects missing JWT secret in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret(undefined)).toThrow(
      'JWT_SECRET must be configured before the application starts.',
    );
  });

  it('accepts chatbot confirm secret from JWT secret in production', () => {
    process.env.NODE_ENV = 'production';
    expect(getChatbotConfirmSecret(undefined, 'jwt-secret')).toBe('jwt-secret');
  });

  it('rejects missing message encryption key in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getMessagesEncryptionSecret(undefined)).toThrow(
      'MESSAGES_ENCRYPTION_KEY must be configured before the application starts.',
    );
  });

  it('keeps swagger enabled outside production', () => {
    expect(isSwaggerEnabled()).toBe(true);
  });

  it('disables swagger by default in production', () => {
    process.env.NODE_ENV = 'production';
    expect(isSwaggerEnabled()).toBe(false);
  });

  it('honors explicit swagger enablement in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';
    expect(isSwaggerEnabled()).toBe(true);
  });
});
