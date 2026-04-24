import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sgMail = require('@sendgrid/mail');
import { getEmailBaseTemplate } from './templates/email-base.template';
import {
  getVerificationCodeTemplate,
  getPasswordResetTemplate,
  getWelcomeTemplate,
  getOrganizationInvitationTemplate,
  getOrganizationPendingTemplate,
  getOrganizationApprovedTemplate,
  getOrganizationRejectedTemplate,
  getVolunteerApprovedTemplate,
  getVolunteerDeniedTemplate,
  getOrderConfirmationTemplate,
  getBioherbsOrderConfirmationTemplate,
} from './templates/email-templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    this.from = this.configService.get<string>('MAIL_FROM');

    if (!this.apiKey) {
      console.warn(
        'WARNING: SENDGRID_API_KEY is not defined. Email functionality will be disabled.',
      );
      return;
    }

    sgMail.setApiKey(this.apiKey);

    if (!this.from) {
      console.warn(
        'WARNING: MAIL_FROM is not defined. Email functionality may not work as expected.',
      );
    }
  }

  async sendVerificationCode(email: string, code: string): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping verification email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getVerificationCodeTemplate(code);
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: 'CogniCare - Verify Your Email Address',
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Verification email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send verification email:', err);

      // Provide more specific error messages
      if (err && typeof err === 'object' && 'code' in err && err.code === 403) {
        console.error('SendGrid Error: Your sender email is not verified.');
        console.error(
          'Please verify your sender identity at: https://app.sendgrid.com/settings/sender_auth/senders',
        );
        throw new InternalServerErrorException(
          'Email sending is not properly configured. Please contact support.',
        );
      }

      throw new InternalServerErrorException(
        'Could not send verification email. Please try again later.',
      );
    }
  }

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping password reset email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getPasswordResetTemplate(code);
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: 'CogniCare - Password Reset Request',
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Password reset email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send password reset email:', err);
      throw new InternalServerErrorException(
        'Could not send password reset email. Please try again later.',
      );
    }
  }

  async sendWelcomeEmail(email: string, userName: string): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping welcome email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getWelcomeTemplate(userName);
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: 'Welcome to CogniCare! 🎉',
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Welcome email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send welcome email:', err);
      // Don't throw error for welcome emails - it's not critical
    }
  }

  async sendOrganizationInvitation(
    email: string,
    organizationName: string,
    invitationType: 'staff' | 'family',
    acceptUrl: string,
    rejectUrl: string,
  ): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping invitation email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getOrganizationInvitationTemplate(
      organizationName,
      invitationType,
      acceptUrl,
      rejectUrl,
    );
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: `You're Invited to Join ${organizationName} on CogniCare`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Organization invitation email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send invitation email:', err);
      throw new InternalServerErrorException(
        'Could not send invitation email. Please try again later.',
      );
    }
  }

  async sendOrganizationPending(
    email: string,
    organizationName: string,
    leaderName: string,
  ): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping organization pending email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getOrganizationPendingTemplate(
      organizationName,
      leaderName,
    );
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: `Organization Application Received - ${organizationName}`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Organization pending email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send organization pending email:', err);
      throw new InternalServerErrorException(
        'Could not send organization pending email.',
      );
    }
  }

  async sendOrganizationApproved(
    email: string,
    organizationName: string,
    leaderName: string,
  ): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping organization approved email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getOrganizationApprovedTemplate(
      organizationName,
      leaderName,
    );
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: `🎉 Your Organization "${organizationName}" Has Been Approved!`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Organization approved email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send organization approved email:', err);
      throw new InternalServerErrorException(
        'Could not send organization approved email.',
      );
    }
  }

  async sendOrganizationRejected(
    email: string,
    organizationName: string,
    leaderName: string,
    rejectionReason?: string,
  ): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping organization rejected email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }

    const emailContent = getOrganizationRejectedTemplate(
      organizationName,
      leaderName,
      rejectionReason,
    );
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: `Organization Application Update - ${organizationName}`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Organization rejected email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send organization rejected email:', err);
      throw new InternalServerErrorException(
        'Could not send organization rejected email.',
      );
    }
  }

  async sendVolunteerApproved(email: string, userName: string): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping volunteer approved email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }
    const emailContent = getVolunteerApprovedTemplate(userName);
    const htmlContent = getEmailBaseTemplate(emailContent);
    const msg = {
      to: email,
      from: this.from,
      subject: 'CogniCare – Your volunteer application has been approved',
      html: htmlContent,
    };
    try {
      await sgMail.send(msg);
      this.logger.debug('Volunteer approved email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send volunteer approved email:', err);
      throw new InternalServerErrorException(
        'Could not send volunteer approved email.',
      );
    }
  }

  async sendVolunteerDenied(
    email: string,
    userName: string,
    deniedReason?: string,
    courseUrl?: string,
  ): Promise<void> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping volunteer denied email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return;
    }
    const emailContent = getVolunteerDeniedTemplate(
      userName,
      deniedReason,
      courseUrl,
    );
    const htmlContent = getEmailBaseTemplate(emailContent);
    const msg = {
      to: email,
      from: this.from,
      subject: 'CogniCare – Volunteer application update',
      html: htmlContent,
    };
    try {
      await sgMail.send(msg);
      this.logger.debug('Volunteer denied email sent successfully');
    } catch (err: unknown) {
      console.error('Failed to send volunteer denied email:', err);
      throw new InternalServerErrorException(
        'Could not send volunteer denied email.',
      );
    }
  }

  async sendOrgLeaderInvitation(
    email: string,
    leaderName: string,
    organizationName: string,
    acceptUrl: string,
    rejectUrl: string,
  ): Promise<boolean> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping org leader invitation email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return false;
    }

    const emailContent = `
      <h2 style="color: #2c3e50; margin-bottom: 20px;">You've Been Invited to Lead an Organization!</h2>
      <p style="color: #555; font-size: 16px; line-height: 1.6;">
        Hello <strong>${leaderName}</strong>,
      </p>
      <p style="color: #555; font-size: 16px; line-height: 1.6;">
        You have been invited to become the <strong>Organization Leader</strong> for 
        <strong style="color: #6a5acd;">${organizationName}</strong> on the CogniCare platform.
      </p>
      <p style="color: #555; font-size: 16px; line-height: 1.6;">
        As an Organization Leader, you will be able to:
      </p>
      <ul style="color: #555; font-size: 16px; line-height: 1.8;">
        <li>Manage staff members (doctors, therapists, volunteers)</li>
        <li>Oversee families and children in your care</li>
        <li>Access organization analytics and reports</li>
      </ul>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${acceptUrl}" 
           style="background: linear-gradient(135deg, #6a5acd 0%, #836fff 100%); 
                  color: white; 
                  padding: 14px 28px; 
                  text-decoration: none; 
                  border-radius: 8px; 
                  font-weight: bold; 
                  display: inline-block;
                  margin-right: 10px;">
          Accept Invitation
        </a>
        <a href="${rejectUrl}" 
           style="background: #e74c3c; 
                  color: white; 
                  padding: 14px 28px; 
                  text-decoration: none; 
                  border-radius: 8px; 
                  font-weight: bold; 
                  display: inline-block;">
          Decline
        </a>
      </div>
      <p style="color: #888; font-size: 14px; margin-top: 20px;">
        This invitation will expire in 7 days. If you did not expect this invitation, 
        you can safely ignore this email.
      </p>
    `;

    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: email,
      from: this.from,
      subject: `CogniCare – You're Invited to Lead ${organizationName}`,
      html: htmlContent,
    };

    try {
      this.logger.debug('Attempting to send org leader invitation email');

      await sgMail.send(msg);
      this.logger.debug('Org leader invitation email sent successfully');
      return true;
    } catch (err: unknown) {
      // Log detailed error for debugging
      this.logger.error('Failed to send org leader invitation email');

      if (err && typeof err === 'object' && 'code' in err) {
        console.error('SendGrid error code:', err.code);
        if ('response' in err && err.response) {
          console.error(
            'SendGrid response:',
            JSON.stringify(err.response, null, 2),
          );
        }
      }
      console.error('Full error:', err);

      // Don't throw - allow invitation to be created even if email fails
      // This handles cases where SendGrid is misconfigured in production
      console.warn(
        'Invitation created but email not sent. Manual notification may be required.',
      );
      return false;
    }
  }

  /**
   * Envoie un email à CogniCare avec le détail de la commande (pour traitement / passage commande côté marchand).
   */
  async sendOrderToCogniCare(payload: {
    orderId: string;
    productName: string;
    quantity: number;
    price?: string;
    formData: Record<string, string>;
  }): Promise<boolean> {
    const to =
      this.configService.get<string>('COGNICARE_ORDER_EMAIL') || this.from;
    if (!this.apiKey || !this.from || !to) {
      console.warn(
        'Skipping order email to CogniCare: SENDGRID_API_KEY, MAIL_FROM or COGNICARE_ORDER_EMAIL not configured',
      );
      return false;
    }

    const d = payload.formData;
    const lines = [
      `<p><strong>Commande #${payload.orderId}</strong></p>`,
      `<p><strong>Produit:</strong> ${payload.productName}</p>`,
      `<p><strong>Quantité:</strong> ${payload.quantity}</p>`,
      payload.price ? `<p><strong>Prix:</strong> ${payload.price}</p>` : '',
      '<hr/><p><strong>Coordonnées / Livraison</strong></p>',
      d.email ? `<p>Email: ${d.email}</p>` : '',
      d.country ? `<p>Pays: ${d.country}</p>` : '',
      d.firstName || d.lastName
        ? `<p>Nom: ${[d.firstName, d.lastName].filter(Boolean).join(' ')}</p>`
        : d.fullName
          ? `<p>Nom: ${d.fullName}</p>`
          : '',
      d.address ? `<p>Adresse: ${d.address}</p>` : '',
      d.postalCode ? `<p>Code postal: ${d.postalCode}</p>` : '',
      d.city ? `<p>Ville: ${d.city}</p>` : '',
      d.phone ? `<p>Téléphone: ${d.phone}</p>` : '',
      d.shippingMethod
        ? `<p><strong>Mode d'expédition:</strong> ${d.shippingMethod}${d.shippingCost ? ` (${d.shippingCost})` : ''}</p>`
        : '',
      d.paymentMethod
        ? `<p><strong>Paiement:</strong> ${d.paymentMethod}</p>`
        : '',
      d.billingSameAsDelivery !== undefined
        ? `<p>Facturation: ${d.billingSameAsDelivery === 'true' ? 'Identique à la livraison' : 'Adresse différente'}</p>`
        : '',
    ].filter(Boolean);

    const htmlContent = getEmailBaseTemplate(lines.join(''));

    const msg = {
      to,
      from: this.from,
      subject: `CogniCare - Nouvelle commande #${payload.orderId} (${payload.productName})`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Order notification email sent successfully');
      return true;
    } catch (err: unknown) {
      console.error('Failed to send order email to CogniCare:', err);
      return false;
    }
  }

  /**
   * Envoie un email de confirmation à l'utilisateur : "Votre commande sera bientôt traitée".
   */
  async sendOrderConfirmationToCustomer(
    customerEmail: string,
    params: { orderId: string; productName: string; quantity: number },
  ): Promise<boolean> {
    if (!this.apiKey || !this.from) {
      console.warn(
        'Skipping order confirmation email: SENDGRID_API_KEY or MAIL_FROM not configured',
      );
      return false;
    }
    if (!customerEmail?.trim()) {
      console.warn('Skipping order confirmation: no customer email');
      return false;
    }

    const emailContent = getOrderConfirmationTemplate(params);
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: customerEmail.trim(),
      from: this.from,
      subject: `CogniCare - Commande #${params.orderId} enregistrée`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('Order confirmation email sent successfully');
      return true;
    } catch (err: unknown) {
      console.error('Failed to send order confirmation to customer:', err);
      return false;
    }
  }

  /**
   * Envoie au client un court email pour les commandes BioHerbs : indique que la confirmation viendra de BioHerbs.
   * Utilisé à la place de sendOrderConfirmationToCustomer pour BioHerbs, pour que le client attende l’email de BioHerbs.
   */
  /** Send booking confirmation email to user */
  async sendBookingConfirmation(
    userEmail: string,
    params: {
      userName: string;
      bookingRef: string;
      date: string;
      startTime: string;
      endTime: string;
      consultationType: string;
      providerName: string;
      preferredLanguage: string;
      mode: string;
    },
  ): Promise<boolean> {
    if (!this.apiKey || !this.from) return false;
    if (!userEmail?.trim()) return false;

    const typeLabel =
      params.consultationType === 'doctor'
        ? 'Médecin'
        : params.consultationType === 'volunteer'
          ? 'Bénévole'
          : 'Coordinateur';

    const modeLabel =
      params.mode === 'video'
        ? 'Vidéo'
        : params.mode === 'in_person'
          ? 'Présentiel'
          : 'Vidéo ou Présentiel';

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#5E60CE;">✅ Consultation Confirmée</h2>
        <p>Bonjour <strong>${params.userName}</strong>,</p>
        <p>Votre consultation a été confirmée avec succès.</p>
        <div style="background:#f8f9fa;border-left:4px solid #5E60CE;padding:16px;margin:16px 0;border-radius:4px;">
          <p><strong>Référence :</strong> ${params.bookingRef}</p>
          <p><strong>Type :</strong> ${typeLabel}</p>
          <p><strong>Professionnel :</strong> ${params.providerName}</p>
          <p><strong>Date :</strong> ${params.date}</p>
          <p><strong>Heure :</strong> ${params.startTime} – ${params.endTime}</p>
          <p><strong>Mode :</strong> ${modeLabel}</p>
          <p><strong>Langue :</strong> ${params.preferredLanguage.toUpperCase()}</p>
        </div>
        <p>Vous recevrez un rappel 24h et 2h avant votre consultation.</p>
        <p style="color:#6c757d;font-size:12px;">Pour annuler ou modifier, connectez-vous à l'application CogniCare.</p>
      </div>`;

    const msg = {
      to: userEmail.trim(),
      from: this.from,
      subject: `CogniCare - Confirmation de consultation ${params.bookingRef}`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      return true;
    } catch (err: unknown) {
      console.error('Failed to send booking confirmation email:', err);
      return false;
    }
  }

  /** Send booking reminder email */
  async sendBookingReminder(
    userEmail: string,
    params: {
      userName: string;
      bookingRef: string;
      date: string;
      startTime: string;
      providerName: string;
      hoursUntil: number;
    },
  ): Promise<boolean> {
    if (!this.apiKey || !this.from) return false;
    if (!userEmail?.trim()) return false;

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#5E60CE;">⏰ Rappel de Consultation</h2>
        <p>Bonjour <strong>${params.userName}</strong>,</p>
        <p>Rappel : votre consultation est dans <strong>${params.hoursUntil} heure(s)</strong>.</p>
        <div style="background:#f8f9fa;border-left:4px solid #5E60CE;padding:16px;margin:16px 0;border-radius:4px;">
          <p><strong>Référence :</strong> ${params.bookingRef}</p>
          <p><strong>Professionnel :</strong> ${params.providerName}</p>
          <p><strong>Date :</strong> ${params.date}</p>
          <p><strong>Heure :</strong> ${params.startTime}</p>
        </div>
        <p style="color:#6c757d;font-size:12px;">CogniCare – Votre partenaire de confiance.</p>
      </div>`;

    const msg = {
      to: userEmail.trim(),
      from: this.from,
      subject: `CogniCare - Rappel consultation dans ${params.hoursUntil}h – ${params.bookingRef}`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      return true;
    } catch (err: unknown) {
      console.error('Failed to send booking reminder email:', err);
      return false;
    }
  }

  async sendBioherbsOrderConfirmationToCustomer(
    customerEmail: string,
    params: {
      orderId: string;
      productName: string;
      quantity: number;
      sentToBioherbs: boolean;
    },
  ): Promise<boolean> {
    if (!this.apiKey || !this.from) return false;
    if (!customerEmail?.trim()) return false;

    const emailContent = getBioherbsOrderConfirmationTemplate(params);
    const htmlContent = getEmailBaseTemplate(emailContent);

    const msg = {
      to: customerEmail.trim(),
      from: this.from,
      subject: `Commande transmise à BioHerbs - #${params.orderId}`,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
      this.logger.debug('BioHerbs order confirmation email sent successfully');
      return true;
    } catch (err: unknown) {
      console.error('Failed to send BioHerbs order confirmation:', err);
      return false;
    }
  }
}
