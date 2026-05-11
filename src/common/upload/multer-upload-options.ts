import { BadRequestException } from '@nestjs/common';
import {
  assertAllowedImageMime,
  assertAllowedVoiceMime,
  normalizeMimeType,
  UPLOAD_LIMITS,
} from './upload-policy';

type MulterLikeFile = { mimetype?: string; originalname?: string };
type MulterFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

function rejectInvalidMime(
  cb: MulterFileFilterCallback,
  message: string,
): void {
  cb(new BadRequestException(message) as unknown as Error, false);
}

export function buildImageUploadOptions(
  maxBytes: number = UPLOAD_LIMITS.imageBytes,
) {
  return {
    limits: {
      fileSize: maxBytes,
      files: 1,
    },
    fileFilter: (
      _req: any,
      file: MulterLikeFile,
      cb: MulterFileFilterCallback,
    ) => {
      try {
        const mimetype = normalizeMimeType(file.mimetype);
        assertAllowedImageMime(mimetype);
        cb(null, true);
      } catch {
        rejectInvalidMime(cb, 'UPLOAD_INVALID_IMAGE_TYPE');
      }
    },
  };
}

export function buildImageOrVoiceUploadOptions(
  maxBytes: number = UPLOAD_LIMITS.voiceBytes,
) {
  return {
    limits: {
      fileSize: maxBytes,
      files: 1,
    },
    fileFilter: (
      _req: any,
      file: MulterLikeFile,
      cb: MulterFileFilterCallback,
    ) => {
      const mimetype = normalizeMimeType(file.mimetype);
      try {
        assertAllowedImageMime(mimetype);
        cb(null, true);
        return;
      } catch {
        // fall through to voice validation
      }
      try {
        assertAllowedVoiceMime(mimetype);
        cb(null, true);
      } catch {
        rejectInvalidMime(cb, 'UPLOAD_INVALID_MEDIA_TYPE');
      }
    },
  };
}

export function buildPdfUploadOptions(maxBytes: number = 10 * 1024 * 1024) {
  return {
    limits: {
      fileSize: maxBytes,
      files: 1,
    },
    fileFilter: (
      _req: any,
      file: MulterLikeFile,
      cb: MulterFileFilterCallback,
    ) => {
      const mimetype = normalizeMimeType(file.mimetype);
      if (mimetype !== 'application/pdf') {
        rejectInvalidMime(cb, 'UPLOAD_INVALID_PDF_TYPE');
        return;
      }
      cb(null, true);
    },
  };
}

export function buildExcelUploadOptions(maxBytes: number = 10 * 1024 * 1024) {
  const xlsxMimes = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);
  const csvMimes = new Set([
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
  ]);

  return {
    limits: {
      fileSize: maxBytes,
      files: 1,
    },
    fileFilter: (
      _req: any,
      file: MulterLikeFile,
      cb: MulterFileFilterCallback,
    ) => {
      const mimetype = normalizeMimeType(file.mimetype);
      const originalname = file.originalname?.toLowerCase() ?? '';
      const isXlsx = originalname.endsWith('.xlsx') && xlsxMimes.has(mimetype);
      const isCsv = originalname.endsWith('.csv') && csvMimes.has(mimetype);
      if (!isXlsx && !isCsv) {
        rejectInvalidMime(cb, 'UPLOAD_INVALID_EXCEL_TYPE');
        return;
      }
      cb(null, true);
    },
  };
}
