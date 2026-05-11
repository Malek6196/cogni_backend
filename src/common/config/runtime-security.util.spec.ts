import {
  getConfiguredCorsOrigins,
  getChatbotConfirmSecret,
  getJwtSecret,
  getMongoDbUri,
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
    const jwtSecret = 'a'.repeat(32);
    expect(getChatbotConfirmSecret(undefined, jwtSecret)).toBe(jwtSecret);
  });

  it('rejects short production JWT secrets', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret('too-short')).toThrow(
      'JWT_SECRET must be at least 32 characters in production.',
    );
  });

  it('rejects placeholder production JWT secrets', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      getJwtSecret('development-only-jwt-secret-that-is-long'),
    ).toThrow('JWT_SECRET must not use a placeholder value in production.');
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

  it('uses a local MongoDB fallback outside production', () => {
    expect(getMongoDbUri(undefined)).toBe(
      'mongodb://localhost:27017/cognicare',
    );
  });

  it('rejects missing production CORS origins', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getConfiguredCorsOrigins(undefined)).toThrow(
      'CORS_ORIGIN must be configured in production.',
    );
  });

  it('rejects non-https production CORS origins', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getConfiguredCorsOrigins('http://example.com')).toThrow(
      'CORS_ORIGIN entries must use https:// in production.',
    );
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
