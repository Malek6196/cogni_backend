const PRODUCTION_NODE_ENV = 'production';

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

export function getRequiredRuntimeSecret(
  name: string,
  value: string | undefined | null,
  developmentFallback?: string,
): string {
  const normalized = normalizeSecret(value);
  if (normalized) {
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

export function isSwaggerEnabled(): boolean {
  if (!isProductionEnvironment()) {
    return true;
  }

  return normalizeSecret(process.env.SWAGGER_ENABLED)?.toLowerCase() === 'true';
}
