import { BadRequestException, Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private configured = false;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Validate file size before upload
   */
  private validateFileSize(buffer: Buffer, maxSizeBytes: number): void {
    if (buffer.length > maxSizeBytes) {
      throw new BadRequestException(
        `File size exceeds ${maxSizeBytes / 1024 / 1024}MB limit`,
      );
    }
  }

  /**
   * Upload image from buffer. Returns the public URL (secure_url).
   * Throws if Cloudinary is not configured.
   */
  async uploadBuffer(
    buffer: Buffer,
    options: { folder: string; publicId?: string; maxSizeBytes?: number },
  ): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }

    // Validate file size (default: 10MB for images)
    this.validateFileSize(buffer, options.maxSizeBytes || 10 * 1024 * 1024);
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: 'image',
        },
        (err, result) => {
          if (err) {
            const error: Error =
              err instanceof Error
                ? err
                : new Error(
                    typeof (err as { message?: string })?.message === 'string'
                      ? (err as { message: string }).message
                      : 'Cloudinary upload failed',
                  );
            reject(error);
            return;
          }
          if (!result?.secure_url) {
            reject(new Error('Cloudinary did not return a URL'));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(buffer);
    });
  }

  /**
   * Upload raw file (e.g. PDF) from buffer. Returns the public URL (secure_url).
   * Use for documents: ID, certificates. Throws if Cloudinary is not configured.
   */
  async uploadRawBuffer(
    buffer: Buffer,
    options: {
      folder: string;
      publicId?: string;
      resourceType?: 'raw' | 'auto';
      maxSizeBytes?: number;
    },
  ): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }

    // Validate file size (default: 50MB for documents)
    this.validateFileSize(buffer, options.maxSizeBytes || 50 * 1024 * 1024);
    const resourceType = options.resourceType ?? 'raw';
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: resourceType,
        },
        (err, result) => {
          if (err) {
            const error: Error =
              err instanceof Error
                ? err
                : new Error(
                    typeof (err as { message?: string })?.message === 'string'
                      ? (err as { message: string }).message
                      : 'Cloudinary upload failed',
                  );
            reject(error);
            return;
          }
          if (!result?.secure_url) {
            reject(new Error('Cloudinary did not return a URL'));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(buffer);
    });
  }

  /**
   * Upload audio (e.g. m4a voice note). Cloudinary treats many audio formats as `video` resource type.
   */
  async uploadVideoResourceBuffer(
    buffer: Buffer,
    options: { folder: string; publicId?: string; maxSizeBytes?: number },
  ): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }

    // Validate file size (default: 50MB for video/audio)
    this.validateFileSize(buffer, options.maxSizeBytes || 50 * 1024 * 1024);
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: 'video',
        },
        (err, result) => {
          if (err) {
            const error: Error =
              err instanceof Error
                ? err
                : new Error(
                    typeof (err as { message?: string })?.message === 'string'
                      ? (err as { message: string }).message
                      : 'Cloudinary upload failed',
                  );
            reject(error);
            return;
          }
          if (!result?.secure_url) {
            reject(new Error('Cloudinary did not return a URL'));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(buffer);
    });
  }

  async uploadAuthenticatedBuffer(
    buffer: Buffer,
    options: {
      folder: string;
      publicId: string;
      resourceType: 'image' | 'video' | 'raw';
      maxSizeBytes?: number;
    },
  ): Promise<{ publicId: string; resourceType: 'image' | 'video' | 'raw' }> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }

    this.validateFileSize(buffer, options.maxSizeBytes || 50 * 1024 * 1024);
    const fullPublicId = `${options.folder}/${options.publicId}`;
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: options.resourceType,
          type: 'authenticated',
        },
        (err, result) => {
          if (err) {
            const error: Error =
              err instanceof Error
                ? err
                : new Error(
                    typeof (err as { message?: string })?.message === 'string'
                      ? (err as { message: string }).message
                      : 'Cloudinary upload failed',
                  );
            reject(error);
            return;
          }
          if (!result?.public_id) {
            reject(new Error('Cloudinary did not return a public id'));
            return;
          }
          resolve({
            publicId: result.public_id || fullPublicId,
            resourceType: options.resourceType,
          });
        },
      );
      uploadStream.end(buffer);
    });
  }

  createAuthenticatedUrl(
    publicId: string,
    resourceType: 'image' | 'video' | 'raw',
    expiresInSeconds = 300,
  ): string {
    if (!this.configured) {
      throw new Error('Cloudinary is not configured.');
    }

    return cloudinary.url(publicId, {
      secure: true,
      sign_url: true,
      type: 'authenticated',
      resource_type: resourceType,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
  }
}
