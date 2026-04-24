const REDACTED = '<redacted>';

const SECRET_QUERY_KEY_RE =
  /(?:token|secret|password|code|key|auth|signature|sig)/i;

const KNOWN_SECRET_PATH_KEYS = new Set([
  'invitation',
  'invitations',
  'token',
  'tokens',
  'confirm-account',
  'reject-invitation',
]);

function looksSecretValue(segment: string): boolean {
  const value = segment.trim();
  if (!value) return false;
  // Typical invitation/JWT/API token payload lengths.
  if (value.length >= 20) return true;
  // Hex-like or base64url-ish short tokens.
  if (/^[a-f0-9]{16,}$/i.test(value)) return true;
  if (/^[A-Za-z0-9\-_]{16,}$/.test(value)) return true;
  return false;
}

function sanitizePathname(pathname: string): string {
  const parts = pathname.split('/');
  const sanitized: string[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const prev = i > 0 ? parts[i - 1].toLowerCase() : '';

    if ((prev && KNOWN_SECRET_PATH_KEYS.has(prev)) || looksSecretValue(part)) {
      sanitized.push(REDACTED);
      continue;
    }
    sanitized.push(part);
  }

  return sanitized.join('/');
}

export function sanitizeUrlForLogs(url: string | undefined | null): string {
  if (!url) return '/';
  try {
    const parsed = new URL(url, 'http://localhost');
    const params = new URLSearchParams(parsed.search);
    for (const [key] of params.entries()) {
      if (SECRET_QUERY_KEY_RE.test(key)) {
        params.set(key, REDACTED);
      }
    }
    const search = params.toString();
    const pathname = sanitizePathname(parsed.pathname);
    return `${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return sanitizePathname(url);
  }
}
