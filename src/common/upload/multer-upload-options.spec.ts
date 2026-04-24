import { BadRequestException } from '@nestjs/common';
import {
  buildImageOrVoiceUploadOptions,
  buildImageUploadOptions,
  buildPdfUploadOptions,
} from './multer-upload-options';

function runFileFilter(
  options: {
    fileFilter: (
      req: unknown,
      file: { mimetype?: string },
      cb: (error: unknown, acceptFile: boolean) => void,
    ) => void;
  },
  mimetype: string,
): { error: unknown; accepted: boolean } {
  let error: unknown;
  let accepted = false;
  options.fileFilter({}, { mimetype }, (err, acceptFile) => {
    error = err;
    accepted = acceptFile;
  });
  return { error, accepted };
}

describe('multer upload options', () => {
  it('accepts only image mime types for image options', () => {
    const options = buildImageUploadOptions();
    const accepted = runFileFilter(options, 'image/png');
    const rejected = runFileFilter(options, 'text/plain');

    expect(accepted.error).toBeNull();
    expect(accepted.accepted).toBe(true);
    expect(rejected.error).toBeInstanceOf(BadRequestException);
    expect(rejected.accepted).toBe(false);
  });

  it('accepts image or voice mime types for media options', () => {
    const options = buildImageOrVoiceUploadOptions();
    const imageAccepted = runFileFilter(options, 'image/jpeg');
    const voiceAccepted = runFileFilter(options, 'audio/mpeg');
    const rejected = runFileFilter(options, 'application/pdf');

    expect(imageAccepted.error).toBeNull();
    expect(imageAccepted.accepted).toBe(true);
    expect(voiceAccepted.error).toBeNull();
    expect(voiceAccepted.accepted).toBe(true);
    expect(rejected.error).toBeInstanceOf(BadRequestException);
    expect(rejected.accepted).toBe(false);
  });

  it('accepts only pdf mime types for pdf options', () => {
    const options = buildPdfUploadOptions();
    const accepted = runFileFilter(options, 'application/pdf');
    const rejected = runFileFilter(options, 'image/png');

    expect(accepted.error).toBeNull();
    expect(accepted.accepted).toBe(true);
    expect(rejected.error).toBeInstanceOf(BadRequestException);
    expect(rejected.accepted).toBe(false);
  });

  it('exposes configured file size limits', () => {
    const options = buildImageUploadOptions(1234);
    expect(options.limits.fileSize).toBe(1234);
    expect(options.limits.files).toBe(1);
  });
});
