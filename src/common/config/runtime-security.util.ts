const PRODUCTION_NODE_ENV = 'production';
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const PLACEHOLDER_PATTERNS = [
  'development-only',
  'changeme',
  'change-me',
  'replace-me',
  'placeholder',
  'your-secret',
] as const;

function normalizeSecret(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === PRODUCTION_NODE_ENV;
}

function isPlaceholderSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

function assertProductionSecretQuality(name: string, value: string): void {
  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`,
    );
  }

  if (isPlaceholderSecret(value)) {
    throw new Error(`${name} must not use a placeholder value in production.`);
  }
}

export function getRequiredRuntimeSecret(
  name: string,
  value: string | undefined | null,
  developmentFallback?: string,
): string {
  const normalized = normalizeSecret(value);
  if (normalized) {
    if (isProductionEnvironment()) {
      assertProductionSecretQuality(name, normalized);
    }
    return normalized;
  }

  if (!isProductionEnvironment() && developmentFallback) {
    return developmentFallback;
  }

  throw new Error(`${name} must be configured before the application starts.`);
}

export function getJwtSecret(
  value: string | undefined | null,
  developmentFallback = 'development-only-jwt-secret',
): string {
  return getRequiredRuntimeSecret('JWT_SECRET', value, developmentFallback);
}

export function getChatbotConfirmSecret(
  confirmSecret: string | undefined | null,
  jwtSecret: string | undefined | null,
  developmentFallback = 'development-only-chatbot-confirm-secret',
): string {
  return getRequiredRuntimeSecret(
    'CHATBOT_CONFIRM_SECRET or JWT_SECRET',
    normalizeSecret(confirmSecret) ?? normalizeSecret(jwtSecret),
    developmentFallback,
  );
}

export function getMessagesEncryptionSecret(
  value: string | undefined | null,
  developmentFallback = 'development-only-messages-encryption-key',
): string {
  return getRequiredRuntimeSecret(
    'MESSAGES_ENCRYPTION_KEY',
    value,
    developmentFallback,
  );
}

export function getMongoDbUri(
  value: string | undefined | null,
  developmentFallback = 'mongodb://localhost:27017/cognicare',
): string {
  const uri = normalizeSecret(value);
  const resolved =
    uri ??
    (!isProductionEnvironment() && developmentFallback
      ? developmentFallback
      : undefined);

  if (!resolved) {
    throw new Error(
      'MONGODB_URI must be configured before the application starts.',
    );
  }

  if (
    isProductionEnvironment() &&
    (!resolved.startsWith('mongodb://') &&
      !resolved.startsWith('mongodb+srv://'))
  ) {
    throw new Error(
      'MONGODB_URI must be a valid MongoDB connection string in production.',
    );
  }

  if (
    isProductionEnvironment() &&
    (resolved.includes('localhost') || resolved.includes('127.0.0.1'))
  ) {
    throw new Error('MONGODB_URI must not point to localhost in production.');
  }

  return resolved;
}

export function getConfiguredCorsOrigins(
  value: string | undefined | null,
): string[] {
  const origins = normalizeSecret(value)
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins || origins.length === 0) {
    if (isProductionEnvironment()) {
      throw new Error('CORS_ORIGIN must be configured in production.');
    }
    return [];
  }

  if (isProductionEnvironment()) {
    for (const origin of origins) {
      if (!origin.startsWith('https://')) {
        throw new Error(
          'CORS_ORIGIN entries must use https:// in production.',
        );
      }
      if (origin.includes('*')) {
        throw new Error('CORS_ORIGIN must not contain wildcards in production.');
      }
    }
  }

  return origins;
}

export function isSwaggerEnabled(): boolean {
  if (!isProductionEnvironment()) {
    return true;
  }

  return normalizeSecret(process.env.SWAGGER_ENABLED)?.toLowerCase() === 'true';
}
