import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import { SocialProvider } from './dto/social-login.dto';

export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  providerUserId: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
}

@Injectable()
export class SocialTokenVerifierService {
  private readonly googleJwks = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );

  constructor(private readonly configService: ConfigService) {}

  async verifySocialIdToken(
    provider: SocialProvider,
    idToken: string,
  ): Promise<VerifiedSocialIdentity> {
    if (provider === SocialProvider.GOOGLE) {
      return this.verifyGoogleIdToken(idToken);
    }

    throw new UnauthorizedException('Unsupported social provider');
  }

  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<VerifiedSocialIdentity> {
    const audiences = this.getAllowedAudiences([
      'GOOGLE_CLIENT_IDS',
      'GOOGLE_CLIENT_ID',
    ]);

    if (audiences.length === 0) {
      throw new UnauthorizedException(
        'Google login is not configured on the server',
      );
    }

    try {
      const { payload } = await jwtVerify(idToken, this.googleJwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: audiences,
      });

      const providerUserId = this.getStringClaim(payload, 'sub');
      const email = this.getOptionalStringClaim(payload, 'email');
      const emailVerified = this.getBooleanLikeClaim(payload, 'email_verified');
      const fullName = this.getOptionalStringClaim(payload, 'name');

      if (!providerUserId || !email) {
        throw new UnauthorizedException('Invalid Google identity token');
      }

      return {
        provider: SocialProvider.GOOGLE,
        providerUserId,
        email,
        emailVerified,
        fullName,
      };
    } catch {
      throw new UnauthorizedException('Invalid Google identity token');
    }
  }

  private getAllowedAudiences(keys: string[]): string[] {
    const values = keys
      .map((key) => this.configService.get<string>(key) ?? '')
      .filter((value) => value.length > 0);

    const audiences = values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return Array.from(new Set(audiences));
  }

  private getStringClaim(payload: JWTPayload, claim: string): string {
    const value = payload[claim];
    return typeof value === 'string' ? value : '';
  }

  private getOptionalStringClaim(
    payload: JWTPayload,
    claim: string,
  ): string | undefined {
    const value = payload[claim];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private getBooleanLikeClaim(payload: JWTPayload, claim: string): boolean {
    const value = payload[claim];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    if (typeof value === 'number') {
      return value === 1;
    }
    return false;
  }
}
