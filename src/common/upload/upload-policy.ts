import { BadRequestException } from '@nestjs/common';

export const UPLOAD_LIMITS = {
  imageBytes: 5 * 1024 * 1024, // 5MB
  voiceBytes: 10 * 1024 * 1024, // 10MB
} as const;

export const IMAGE_MIME_ALLOWLIST = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const VOICE_MIME_ALLOWLIST_PREFIXES = ['audio/'] as const;

export function normalizeMimeType(mimetype: string | undefined): string {
  const value = (mimetype ?? '').toLowerCase().trim();
  if (!value || value === 'application/octet-stream') {
    return 'application/octet-stream';
  }
  return value;
}

export function isAllowedImageMime(mimetype: string): boolean {
  return (
    IMAGE_MIME_ALLOWLIST.includes(
      mimetype as (typeof IMAGE_MIME_ALLOWLIST)[number],
    ) || mimetype.startsWith('image/')
  );
}

export function isAllowedVoiceMime(mimetype: string): boolean {
  if (mimetype === 'application/octet-stream') return true;
  return VOICE_MIME_ALLOWLIST_PREFIXES.some((prefix) =>
    mimetype.startsWith(prefix),
  );
}

export function assertUploadPresent(
  file: { buffer?: Buffer } | undefined,
): asserts file is { buffer: Buffer } {
  if (!file?.buffer) {
    throw new BadRequestException('UPLOAD_FILE_REQUIRED');
  }
}

export function assertUploadSize(buffer: Buffer, maxBytes: number): void {
  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `UPLOAD_FILE_TOO_LARGE_MAX_${Math.ceil(maxBytes / (1024 * 1024))}MB`,
    );
  }
}

export function assertAllowedImageMime(mimetype: string): void {
  if (!isAllowedImageMime(mimetype)) {
    throw new BadRequestException('UPLOAD_INVALID_IMAGE_TYPE');
  }
}

export function assertAllowedVoiceMime(mimetype: string): void {
  if (!isAllowedVoiceMime(mimetype)) {
    throw new BadRequestException('UPLOAD_INVALID_VOICE_TYPE');
  }
}
