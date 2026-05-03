import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Mock mail service for development/testing.
 *
 * Sensitive message bodies are hidden by default. Set
 * LOG_MOCK_EMAIL_CONTENT=true outside production only when a local developer
 * explicitly needs to copy a verification code or invitation link.
 */
@Injectable()
export class MailMockService {
  private readonly logger = new Logger(MailMockService.name);

  private shouldRevealContent(): boolean {
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.LOG_MOCK_EMAIL_CONTENT === 'true'
    );
  }

  private hashEmail(email: string): string {
    return createHash('sha256').update(email).digest('hex').slice(0, 12);
  }

  private logMockEmail(
    kind: string,
    email: string,
    sensitiveDetails?: Record<string, string | undefined>,
  ): void {
    this.logger.warn(
      `Mock email generated kind=${kind} recipient=${this.hashEmail(email)}`,
    );

    if (!this.shouldRevealContent() || !sensitiveDetails) {
      return;
    }

    for (const [key, value] of Object.entries(sensitiveDetails)) {
      if (value) {
        this.logger.warn(`Mock email detail ${key}=${value}`);
      }
    }
  }

  sendVerificationCode(email: string, code: string): Promise<void> {
    this.logMockEmail('verification_code', email, { code });
    return Promise.resolve();
  }

  sendPasswordReset(email: string, resetCode: string): Promise<void> {
    return this.sendPasswordResetCode(email, resetCode);
  }

  sendPasswordResetCode(email: string, resetCode: string): Promise<void> {
    this.logMockEmail('password_reset', email, { resetCode });
    return Promise.resolve();
  }

  sendWelcome(email: string, fullName: string): Promise<void> {
    return this.sendWelcomeEmail(email, fullName);
  }

  sendWelcomeEmail(email: string, _fullName: string): Promise<void> {
    this.logMockEmail('welcome', email);
    return Promise.resolve();
  }

  sendOrganizationInvitation(
    email: string,
    _orgName: string,
    _userName: string,
    acceptUrl: string,
    rejectUrl: string,
  ): Promise<void> {
    this.logMockEmail('organization_invitation', email, {
      acceptUrl,
      rejectUrl,
    });
    return Promise.resolve();
  }

  sendOrganizationPending(
    email: string,
    _orgName: string,
    _userName: string,
  ): Promise<void> {
    this.logMockEmail('organization_pending', email);
    return Promise.resolve();
  }

  sendOrganizationApproved(
    email: string,
    _orgName: string,
    _userName: string,
  ): Promise<void> {
    this.logMockEmail('organization_approved', email);
    return Promise.resolve();
  }

  sendOrganizationRejected(
    email: string,
    _orgName: string,
    _userName: string,
    _reason?: string,
  ): Promise<void> {
    this.logMockEmail('organization_rejected', email);
    return Promise.resolve();
  }

  sendVolunteerApproved(email: string, _userName: string): Promise<void> {
    this.logMockEmail('volunteer_approved', email);
    return Promise.resolve();
  }

  sendVolunteerDenied(
    email: string,
    _userName: string,
    _reason?: string,
  ): Promise<void> {
    this.logMockEmail('volunteer_denied', email);
    return Promise.resolve();
  }

  sendOrgLeaderInvitation(
    email: string,
    _leaderName: string,
    _organizationName: string,
    acceptUrl: string,
    rejectUrl: string,
  ): Promise<boolean> {
    this.logMockEmail('org_leader_invitation', email, {
      acceptUrl,
      rejectUrl,
    });
    return Promise.resolve(true);
  }
}
