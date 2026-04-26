import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { promises as fs } from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import {
  PDFFont,
  PDFDocument,
  PDFPage,
  RGB,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { VolunteerApplication } from './schemas/volunteer-application.schema';
import { VolunteerTask } from './schemas/volunteer-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import {
  Availability,
  AvailabilityDocument,
} from '../availabilities/availability.schema';
import { CertificationAttemptDocument } from '../certification-test/schemas/certification-attempt.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MailService } from '../mail/mail.service';
import { CoursesService } from '../courses/courses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { UpdateApplicationMeDto } from './dto/update-application-me.dto';
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from '../courses/schemas/course-enrollment.schema';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_PDF_MIME = 'application/pdf';
const ALLOWED_MIMES = [...ALLOWED_IMAGE_MIMES, ALLOWED_PDF_MIME];
const DEFAULT_CERT_TEMPLATE_PATH = path.join(
  process.cwd(),
  'assets',
  'certificates',
  'caregiver-certificate-template.pdf',
);
const DEFAULT_CERT_TEMPLATE_HTML_PATH = path.join(
  process.cwd(),
  'assets',
  'certificates',
  'caregiver-certificate-template.html',
);
const DEFAULT_CERT_TEMPLATE_ALT_PDF_PATH = path.join(
  process.cwd(),
  'assets',
  'certificates',
  'Caregiver Certification Certificate-2.pdf',
);
const DEFAULT_CERT_TEMPLATE_PNG_PATH = path.join(
  process.cwd(),
  'assets',
  'certificates',
  'caregiver-certificate-template.png',
);
const DEFAULT_CERT_TEMPLATE_JPG_PATH = path.join(
  process.cwd(),
  'assets',
  'certificates',
  'caregiver-certificate-template.jpg',
);

/** Specialist roles that have a direct careProviderType equivalent. */
const SPECIALIST_ROLES = [
  'occupational_therapist',
  'speech_therapist',
  'psychologist',
  'doctor',
] as const;

/** Map careProviderType to User.role so they stay in sync on approval. */
function careProviderTypeToRole(
  careProviderType: string | undefined,
): string | undefined {
  if (!careProviderType) return undefined;
  const map: Record<string, string> = {
    occupational_therapist: 'occupational_therapist',
    ergotherapist: 'occupational_therapist',
    speech_therapist: 'speech_therapist',
    psychologist: 'psychologist',
    doctor: 'doctor',
    caregiver: 'careProvider',
    organization_leader: 'organization_leader',
    other: 'other',
  };
  return map[careProviderType];
}

/**
 * Whether a user is already a verified professional and can be auto-approved.
 * Only specialist roles (doctors, therapists…) and organisation leaders qualify.
 * Regular caregivers (careProvider / other) must go through the application form
 * and wait for admin approval — they should NOT be auto-approved.
 */
function userHasCareProviderType(
  user: { role?: string; careProviderType?: string } | null,
): boolean {
  if (!user) return false;
  // Medical specialists are already credentialed — auto-approve.
  if (SPECIALIST_ROLES.includes(user.role as (typeof SPECIALIST_ROLES)[number]))
    return true;
  // Organisation leaders come from the CogniWeb admin side — auto-approve.
  if (user.role === 'organization_leader') return true;
  // careProvider (volunteer / aidant) and 'other' must submit the application
  // form and be reviewed by an admin before gaining access.
  return false;
}

/** Effective careProviderType for API response: prefer User.role when it is a specialist role (single source of truth). */
function effectiveCareProviderType(
  appType: string | undefined,
  user: { role?: string; careProviderType?: string } | null,
): string | undefined {
  if (!user) return appType;
  const role = user.role;
  if (
    role &&
    SPECIALIST_ROLES.includes(role as (typeof SPECIALIST_ROLES)[number])
  )
    return role;
  if (user.careProviderType) return user.careProviderType;
  return appType;
}

export type DocumentType = 'id' | 'certificate' | 'other';

type BadgeState = 'locked' | 'unlocked' | 'advanced';

interface VolunteerProfileStatSummary {
  totalPoints: number;
  missionsCompleted: number;
  serviceHours: number;
  completedAppointments: number;
  completedTasks: number;
  completedCourses: number;
}

interface VolunteerProfileBadgeSummary {
  id: string;
  label: string;
  description: string;
  state: BadgeState;
  progressPercent: number;
  currentValue: number;
  nextTarget: number | null;
}

interface VolunteerProfileCompetencySummary {
  id: string;
  label: string;
  source: string;
  reason: string;
}

interface VolunteerProfileAvailabilitySummary {
  active: boolean;
  upcomingDatesCount: number;
  recurringSlotsCount: number;
  nextDate: string | null;
}

interface VolunteerProfileImpactSummary {
  score: number;
  level: string;
  summary: string;
  progressPercent: number;
  nextLevelLabel: string | null;
}

interface VolunteerProfileSummaryResponse {
  refreshedAt: string;
  storyline: string;
  roleLabel: string;
  stats: VolunteerProfileStatSummary;
  availability: VolunteerProfileAvailabilitySummary;
  competencies: VolunteerProfileCompetencySummary[];
  badges: VolunteerProfileBadgeSummary[];
  impact: VolunteerProfileImpactSummary;
}

@Injectable()
export class VolunteersService {
  private readonly logger = new Logger(VolunteersService.name);

  constructor(
    @InjectModel(VolunteerApplication.name)
    private readonly applicationModel: Model<VolunteerApplication>,
    @InjectModel(VolunteerTask.name)
    private readonly volunteerTaskModel: Model<VolunteerTask>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Availability.name)
    private readonly availabilityModel: Model<AvailabilityDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly courseEnrollmentModel: Model<CourseEnrollmentDocument>,
    @InjectModel('CertificationAttempt')
    private readonly certificationAttemptModel: Model<CertificationAttemptDocument>,
    private readonly cloudinary: CloudinaryService,
    private readonly mail: MailService,
    private readonly coursesService: CoursesService,
    private readonly notifications: NotificationsService,
  ) {}

  async getProfileSummary(
    userId: string,
  ): Promise<VolunteerProfileSummaryResponse> {
    const objectId = new Types.ObjectId(userId);
    const [userDoc, applicationDoc, taskDocs, appointmentDocs, availabilityDocs] =
      await Promise.all([
        this.userModel
          .findById(userId)
          .select('role careProviderType specialty createdAt')
          .lean()
          .exec(),
        this.applicationModel
          .findOne({ userId: objectId })
          .select(
            'status careProviderType specialty trainingCertified trainingCertifiedAt createdAt',
          )
          .lean()
          .exec(),
        this.volunteerTaskModel
          .find({ volunteerId: objectId, status: 'completed' })
          .select('status completedAt createdAt')
          .lean()
          .exec(),
        this.appointmentModel
          .find({
            providerId: objectId,
            consultationType: 'volunteer',
            status: 'completed',
          })
          .select('date startTime endTime createdAt')
          .lean()
          .exec(),
        this.availabilityModel
          .find({ volunteerId: objectId })
          .select('dates recurrence recurrenceOn createdAt')
          .lean()
          .exec(),
      ]);

    const enrollmentDocs = await this.courseEnrollmentModel
      .find({
        userId: objectId,
        status: 'completed',
        progressPercent: 100,
      })
      .populate('courseId', 'title isQualificationCourse')
      .select('completedAt courseId')
      .lean()
      .exec();

    const completedTasks = taskDocs.length;
    const completedAppointments = appointmentDocs.length;
    const completedCourses = enrollmentDocs.length;
    const trainingCertified =
      ((applicationDoc as { trainingCertified?: boolean } | null)
        ?.trainingCertified ?? false) === true;
    const serviceHoursRaw = appointmentDocs.reduce((sum, appointmentDoc) => {
      const appointment = appointmentDoc as {
        startTime?: string;
        endTime?: string;
      };
      return sum + this.calculateHoursBetween(appointment.startTime, appointment.endTime);
    }, 0);
    const serviceHours = Number(serviceHoursRaw.toFixed(1));
    const missionsCompleted = completedTasks + completedAppointments;
    const totalPoints =
      completedAppointments * 40 +
      completedTasks * 25 +
      completedCourses * 20 +
      (trainingCertified ? 60 : 0);

    const stats: VolunteerProfileStatSummary = {
      totalPoints,
      missionsCompleted,
      serviceHours,
      completedAppointments,
      completedTasks,
      completedCourses,
    };
    const availability = this.buildAvailabilitySummary(
      availabilityDocs as Array<Record<string, unknown>>,
    );
    const competencies = this.buildCompetencies({
      user: userDoc as Record<string, unknown> | null,
      application: applicationDoc as Record<string, unknown> | null,
      stats,
      availability,
      enrollments: enrollmentDocs as Array<Record<string, unknown>>,
    });
    const badges = this.buildBadges({
      stats,
      availability,
      trainingCertified,
      completedCourses,
    });
    const impact = this.buildImpact({
      stats,
      trainingCertified,
      availability,
    });
    const storyline = this.buildStoryline({
      application: applicationDoc as Record<string, unknown> | null,
      stats,
      availability,
      trainingCertified,
    });

    return {
      refreshedAt: new Date().toISOString(),
      storyline,
      roleLabel: this.resolveRoleLabel(
        userDoc as Record<string, unknown> | null,
        applicationDoc as Record<string, unknown> | null,
      ),
      stats,
      availability,
      competencies,
      badges,
      impact,
    };
  }

  async getOrCreateApplication(userId: string) {
    const userDoc = await this.userModel
      .findById(userId)
      .select('role careProviderType specialty')
      .lean()
      .exec();
    const user = userDoc
      ? {
          role: userDoc.role,
          careProviderType: userDoc.careProviderType,
          specialty: userDoc.specialty,
        }
      : null;

    const appDoc = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    const hasCareProviderType = userHasCareProviderType(user);

    if (!appDoc) {
      const status = hasCareProviderType ? 'approved' : 'pending';
      const payload: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
        status,
        documents: [],
      };
      if (user?.careProviderType)
        payload.careProviderType = user.careProviderType;
      if (
        user?.role &&
        SPECIALIST_ROLES.includes(
          user.role as (typeof SPECIALIST_ROLES)[number],
        )
      )
        payload.careProviderType = payload.careProviderType ?? user.role;
      if (user?.specialty) payload.specialty = user.specialty;
      const created = await this.applicationModel.create(payload);
      return this.toResponse(
        created.toObject() as unknown as Record<string, unknown>,
        false,
        user,
      );
    }

    const app = appDoc.toObject();
    if ((app.status as string) === 'pending' && hasCareProviderType) {
      appDoc.status = 'approved';
      if (
        !appDoc.careProviderType &&
        user?.role &&
        SPECIALIST_ROLES.includes(
          user.role as (typeof SPECIALIST_ROLES)[number],
        )
      )
        appDoc.careProviderType = user.role as any;
      if (!appDoc.careProviderType && user?.careProviderType)
        appDoc.careProviderType = user.careProviderType as any;
      await appDoc.save();
      return this.toResponse(
        appDoc.toObject() as unknown as Record<string, unknown>,
        false,
        user,
      );
    }
    return this.toResponse(
      app as unknown as Record<string, unknown>,
      false,
      user,
    );
  }

  /**
   * Update current user's application (careProviderType, specialty, organization fields).
   * Only allowed when status is pending.
   */
  async updateApplicationMe(
    userId: string,
    dto: UpdateApplicationMeDto,
  ): Promise<Record<string, unknown>> {
    let app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) {
      app = await this.applicationModel.create({
        userId: new Types.ObjectId(userId),
        status: 'pending',
        documents: [],
      });
    }
    if (app.status !== 'pending') {
      throw new BadRequestException(
        'Cannot update application after it has been reviewed',
      );
    }
    if (dto.careProviderType !== undefined) {
      app.careProviderType = dto.careProviderType as any;
    }
    if (dto.specialty !== undefined) app.specialty = dto.specialty;
    if (dto.organizationName !== undefined)
      app.organizationName = dto.organizationName;
    if (dto.organizationRole !== undefined)
      app.organizationRole = dto.organizationRole;
    await app.save();
    const userDoc = await this.userModel
      .findById(userId)
      .select('role careProviderType specialty')
      .lean()
      .exec();
    const user = userDoc
      ? {
          role: userDoc.role,
          careProviderType: userDoc.careProviderType,
          specialty: userDoc.specialty,
        }
      : null;
    return this.toResponse(
      app.toObject() as unknown as Record<string, unknown>,
      false,
      user,
    );
  }

  async addDocument(
    userId: string,
    type: DocumentType,
    file: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    const fileSizeMB = (file.buffer.length / (1024 * 1024)).toFixed(2);
    const maxSizeMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

    if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `La taille du fichier (${fileSizeMB} Mo) dépasse la limite de ${maxSizeMB} Mo. Veuillez compresser votre fichier ou choisir un fichier plus petit.`,
      );
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier invalide (${file.mimetype}). Formats acceptés : JPG, JPEG, PNG, WebP, PDF uniquement.`,
      );
    }

    let app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) {
      app = await this.applicationModel.create({
        userId: new Types.ObjectId(userId),
        status: 'pending',
        documents: [],
      });
    }
    if (app.status !== 'pending') {
      throw new BadRequestException(
        'Cannot add documents after application has been reviewed',
      );
    }

    const isPdf = file.mimetype === ALLOWED_PDF_MIME;
    let url: string;
    if (this.cloudinary.isConfigured()) {
      const folder = 'cognicare/volunteers';
      const publicId = `vol_${userId}_${type}_${Date.now()}`;
      url = isPdf
        ? await this.cloudinary.uploadRawBuffer(file.buffer, {
            folder,
            publicId,
            resourceType: 'raw',
          })
        : await this.cloudinary.uploadBuffer(file.buffer, {
            folder,
            publicId,
          });
    } else {
      const path = await import('path');
      const fs = await import('fs/promises');
      const uploadsDir = path.join(process.cwd(), 'uploads', 'volunteers');
      await fs.mkdir(uploadsDir, { recursive: true });
      const ext = isPdf ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg';
      const filename = `vol_${userId}_${type}_${Date.now()}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, file.buffer);
      url = `/uploads/volunteers/${filename}`;
    }

    const docPublicId = `vol_${userId}_${type}_${Date.now()}`;
    app.documents.push({
      type,
      url,
      publicId: docPublicId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
    });
    await app.save();
    return this.getOrCreateApplication(userId);
  }

  /**
   * Mark volunteer as training certified. Only allowed if they have completed
   * at least one qualification course (status completed, progress 100%).
   */
  async completeCertification(userId: string) {
    const completed =
      await this.coursesService.hasCompletedQualificationCourse(userId);
    if (!completed) {
      throw new BadRequestException(
        'Complete a qualification course (100%) before requesting certification.',
      );
    }
    const app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'approved') {
      throw new BadRequestException(
        'Your volunteer application must be approved first.',
      );
    }
    app.trainingCertified = true;
    app.trainingCertifiedAt = new Date();
    await app.save();
    await this.notifications.createForUser(userId, {
      type: 'volunteer_certification_granted',
      title: 'Certification obtenue',
      description:
        'Agenda et Messages sont maintenant accessibles. Merci pour votre engagement !',
      data: { trainingCertifiedAt: app.trainingCertifiedAt?.toISOString() },
    });
    try {
      await this._ensureCertificationCertificate(userId, app);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'certificate generation failed';
      this.logger.warn(
        `Certification granted but certificate generation failed for user ${userId}: ${message}`,
      );
    }
    return this.getOrCreateApplication(userId);
  }

  async getMyCertificate(userId: string): Promise<Record<string, unknown>> {
    const app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) throw new NotFoundException('Application not found');
    if (!app.trainingCertified) {
      throw new BadRequestException('You are not certified yet.');
    }
    if (!app.certificationCertificateUrl) {
      await this._ensureCertificationCertificate(userId, app);
    }
    if (!app.certificationCertificateUrl) {
      throw new NotFoundException('Certificate is not available yet.');
    }
    return {
      certificateUrl: app.certificationCertificateUrl,
      certificateId: app.certificationCertificateId,
      issuedAt:
        app.certificationIssuedAt?.toISOString() ??
        app.trainingCertifiedAt?.toISOString(),
      generatedAt: app.updatedAt?.toISOString(),
    };
  }

  async getMyCertificatePdf(userId: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) throw new NotFoundException('Application not found');
    if (!app.trainingCertified) {
      throw new BadRequestException('You are not certified yet.');
    }

    const user = await this.userModel
      .findById(userId)
      .select('fullName')
      .lean()
      .exec();
    if (!user?.fullName) {
      throw new NotFoundException('User not found');
    }

    const issuedAt =
      app.certificationIssuedAt ?? app.trainingCertifiedAt ?? new Date();
    const certificateId =
      app.certificationCertificateId ??
      this._buildCertificateId(userId, issuedAt);
    const certData = await this._getCertificateDynamicFields(userId, app);

    const pdf = await this._generateCertificatePdf({
      fullName: user.fullName,
      certificateId,
      issuedAt,
      organizationName: app.organizationName,
      supervisorName: certData.supervisorName,
      authorityName: certData.authorityName,
      quizScorePercent: certData.quizScorePercent,
    });

    if (!app.certificationCertificateUrl) {
      try {
        await this._ensureCertificationCertificate(userId, app);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'certificate generation failed';
        this.logger.warn(
          `Certificate download fallback used for user ${userId}: ${message}`,
        );
      }
    }

    const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      buffer: pdf,
      filename: `caregiver_certificate_${safeId}.pdf`,
    };
  }

  /**
   * Set trainingCertified when user has passed all three training courses (Autism, PECs, TEACCH).
   * Called by TrainingService after a quiz pass. Only applies to caregivers with approved application.
   */
  async setTrainingCertifiedFromTrainingCourses(userId: string): Promise<void> {
    const app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app || app.status !== 'approved') return;
    if (app.careProviderType !== 'caregiver') return;
    if (app.trainingCertified) return;
    app.trainingCertified = true;
    app.trainingCertifiedAt = new Date();
    await app.save();
    await this.notifications.createForUser(userId, {
      type: 'volunteer_certification_granted',
      title: 'Certification obtenue',
      description:
        'Agenda et Messages sont maintenant accessibles. Merci pour votre engagement !',
      data: { trainingCertifiedAt: app.trainingCertifiedAt?.toISOString() },
    });
    try {
      await this._ensureCertificationCertificate(userId, app);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'certificate generation failed';
      this.logger.warn(
        `Auto-certification generated without certificate for user ${userId}: ${message}`,
      );
    }
  }

  async removeDocument(userId: string, documentIndex: number) {
    const app = await this.applicationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'pending') {
      throw new BadRequestException('Cannot remove documents after review');
    }
    if (documentIndex < 0 || documentIndex >= app.documents.length) {
      throw new BadRequestException('Invalid document index');
    }
    app.documents.splice(documentIndex, 1);
    await app.save();
    return this.getOrCreateApplication(userId);
  }

  async listForAdmin(filters?: { status?: 'pending' | 'approved' | 'denied' }) {
    const query: Record<string, unknown> = {};
    if (filters?.status) query.status = filters.status;
    const list = await this.applicationModel
      .find(query)
      .populate('userId', 'fullName email phone')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return list.map((a) => this.toResponse(a as Record<string, unknown>, true));
  }

  async getByIdForAdmin(applicationId: string, _adminId: string) {
    const app = await this.applicationModel
      .findById(applicationId)
      .populate('userId', 'fullName email phone')
      .populate('reviewedBy', 'fullName email')
      .lean()
      .exec();
    if (!app) throw new NotFoundException('Application not found');
    return this.toResponse(app as Record<string, unknown>, true);
  }

  async review(
    applicationId: string,
    adminId: string,
    dto: ReviewApplicationDto,
  ) {
    const app = await this.applicationModel.findById(applicationId).exec();
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'pending') {
      throw new BadRequestException('Application has already been reviewed');
    }
    if (dto.decision === 'denied' && !dto.deniedReason?.trim()) {
      throw new BadRequestException('Denial reason is required when denying');
    }

    app.status = dto.decision;
    app.reviewedBy = new Types.ObjectId(adminId);
    app.reviewedAt = new Date();
    app.deniedReason = dto.deniedReason?.trim();
    await app.save();

    const userId = app.userId.toString();

    if (dto.decision === 'approved') {
      const userDoc = await this.userModel.findById(userId).exec();
      if (userDoc) {
        if (app.careProviderType !== undefined)
          userDoc.careProviderType = app.careProviderType;
        if (app.specialty !== undefined) userDoc.specialty = app.specialty;
        const roleFromType = careProviderTypeToRole(app.careProviderType);
        if (roleFromType) userDoc.role = roleFromType as User['role'];
        await userDoc.save();
      }
    }

    const populated = await this.applicationModel
      .findById(applicationId)
      .populate('userId', 'fullName email')
      .lean()
      .exec();
    const user = (populated as Record<string, unknown>)?.userId as
      | { email?: string; fullName?: string }
      | undefined;
    const email = user?.email;
    const fullName = user?.fullName ?? 'Volunteer';

    if (dto.decision === 'approved' && email) {
      await this.mail.sendVolunteerApproved(email, fullName);
    }
    if (dto.decision === 'denied' && email) {
      const courseUrl = `${process.env.FRONTEND_URL ?? 'https://cognicare.app'}/courses`;
      await this.mail.sendVolunteerDenied(
        email,
        fullName,
        dto.deniedReason,
        courseUrl,
      );
      app.denialNotificationSent = true;
      await app.save();
    }

    return this.getByIdForAdmin(applicationId, adminId);
  }

  private async _ensureCertificationCertificate(
    userId: string,
    app: VolunteerApplication & { save: () => Promise<unknown> },
  ): Promise<void> {
    if (app.certificationCertificateUrl) return;

    const user = await this.userModel
      .findById(userId)
      .select('fullName')
      .lean()
      .exec();
    if (!user?.fullName) {
      throw new NotFoundException('User not found');
    }

    const issuedAt = app.trainingCertifiedAt ?? new Date();
    const certificateId =
      app.certificationCertificateId ??
      this._buildCertificateId(userId, issuedAt);
    const certData = await this._getCertificateDynamicFields(userId, app);
    const pdf = await this._generateCertificatePdf({
      fullName: user.fullName,
      certificateId,
      issuedAt,
      organizationName: app.organizationName,
      supervisorName: certData.supervisorName,
      authorityName: certData.authorityName,
      quizScorePercent: certData.quizScorePercent,
    });
    const certificateUrl = await this._storeCertificateBuffer(
      userId,
      certificateId,
      pdf,
    );

    app.certificationCertificateId = certificateId;
    app.certificationIssuedAt = issuedAt;
    app.certificationCertificateUrl = certificateUrl;
    await app.save();
  }

  private _buildCertificateId(userId: string, issuedAt: Date): string {
    const timestamp = issuedAt
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 12);
    const userSuffix = userId.slice(-6).toUpperCase();
    return `CGC-${timestamp}-${userSuffix}`;
  }

  private async _generateCertificatePdf(input: {
    fullName: string;
    certificateId: string;
    issuedAt: Date;
    organizationName?: string;
    supervisorName?: string;
    authorityName?: string;
    quizScorePercent?: number;
  }): Promise<Buffer> {
    const htmlPdf = await this._generateCertificatePdfFromHtml(input);
    if (htmlPdf) {
      return htmlPdf;
    }

    const templatePath = await this._resolveCertificateTemplatePath();

    let pdfDoc: PDFDocument;
    let page: PDFPage;
    let usingDesignedTemplate = false;

    if (templatePath) {
      const ext = path.extname(templatePath).toLowerCase();
      const template = await fs.readFile(templatePath);
      if (ext === '.pdf') {
        pdfDoc = await PDFDocument.load(template);
        page = pdfDoc.getPages()[0] ?? pdfDoc.addPage([842, 595]);
        usingDesignedTemplate = true;
      } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
        pdfDoc = await PDFDocument.create();
        if (ext === '.png') {
          const bg = await pdfDoc.embedPng(template);
          page = pdfDoc.addPage([bg.width, bg.height]);
          page.drawImage(bg, {
            x: 0,
            y: 0,
            width: bg.width,
            height: bg.height,
          });
        } else {
          const bg = await pdfDoc.embedJpg(template);
          page = pdfDoc.addPage([bg.width, bg.height]);
          page.drawImage(bg, {
            x: 0,
            y: 0,
            width: bg.width,
            height: bg.height,
          });
        }
        usingDesignedTemplate = true;
      } else {
        this.logger.warn(
          `Unsupported certificate template format at ${templatePath}. Using fallback layout.`,
        );
        pdfDoc = await PDFDocument.create();
        page = pdfDoc.addPage([842, 595]);
      }
    } else {
      this.logger.warn(
        'Certificate template not found. Using fallback layout.',
      );
      pdfDoc = await PDFDocument.create();
      page = pdfDoc.addPage([842, 595]);
    }

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();

    const fullName = this._safeCertificateText(input.fullName, 80);
    const organization = this._safeCertificateText(
      input.organizationName?.trim() || 'CogniCare Partner Organization',
      80,
    );
    const supervisor = this._safeCertificateText(
      input.supervisorName?.trim() || 'Organization Supervisor',
      70,
    );
    const authority = this._safeCertificateText(
      input.authorityName?.trim() || 'CogniCare Certification Authority',
      70,
    );
    const issueDate = input.issuedAt.toISOString().slice(0, 10);
    const stageStartDate = issueDate;
    const stageEndDate = issueDate;
    const quizScoreText =
      typeof input.quizScorePercent === 'number'
        ? `${Math.max(0, Math.min(100, Math.round(input.quizScorePercent)))}%`
        : 'N/A';
    const verificationUrl =
      process.env.CAREGIVER_CERTIFICATE_VERIFICATION_URL?.trim() ||
      `https://cognicare.app/certificates/verify/${input.certificateId}`;

    if (usingDesignedTemplate) {
      const textColor = rgb(0.2, 0.2, 0.2);

      // Replace placeholder zones with clean dynamic values.
      page.drawRectangle({
        x: width * 0.19,
        y: height * 0.475,
        width: width * 0.62,
        height: height * 0.07,
        color: rgb(0.96, 0.96, 0.96),
      });
      page.drawRectangle({
        x: width * 0.26,
        y: height * 0.295,
        width: width * 0.48,
        height: height * 0.13,
        color: rgb(0.96, 0.96, 0.96),
      });
      page.drawRectangle({
        x: width * 0.11,
        y: height * 0.162,
        width: width * 0.23,
        height: height * 0.06,
        color: rgb(0.96, 0.96, 0.96),
      });
      page.drawRectangle({
        x: width * 0.66,
        y: height * 0.162,
        width: width * 0.23,
        height: height * 0.06,
        color: rgb(0.96, 0.96, 0.96),
      });

      this._drawCenteredText(
        page,
        fullName.toUpperCase(),
        width,
        height * 0.505,
        Math.max(22, width * 0.033),
        fontBold,
        textColor,
      );

      this._drawCenteredLines(
        page,
        [
          `Quiz Score: ${quizScoreText} | Final Score: ${quizScoreText}`,
          `Organization: ${organization}`,
          `Practical Stage: ${stageStartDate} to ${stageEndDate}`,
          `Certificate ID: ${input.certificateId}`,
          `Issue Date: ${issueDate} | Verify: ${verificationUrl}`,
        ],
        width,
        height * 0.395,
        9,
        12,
        fontRegular,
        textColor,
      );

      this._drawCenteredText(
        page,
        `Issued on ${issueDate}`,
        width,
        height * 0.273,
        8,
        fontRegular,
        textColor,
      );

      page.drawText(supervisor, {
        x: width * 0.12,
        y: height * 0.182,
        size: 7,
        font: fontRegular,
        color: textColor,
      });
      page.drawText(authority, {
        x: width * 0.68,
        y: height * 0.182,
        size: 7,
        font: fontRegular,
        color: textColor,
      });
    } else {
      const title = 'Caregiver Certification';
      this._drawCenteredText(
        page,
        title,
        width,
        height * 0.7,
        24,
        fontBold,
        rgb(0.08, 0.16, 0.3),
      );
      this._drawCenteredText(
        page,
        fullName,
        width,
        height * 0.52,
        32,
        fontBold,
        rgb(0.1, 0.22, 0.35),
      );
      this._drawCenteredText(
        page,
        `Organization: ${organization}`,
        width,
        height * 0.44,
        14,
        fontRegular,
        rgb(0.18, 0.23, 0.3),
      );
      this._drawCenteredText(
        page,
        `Issued on ${issueDate}`,
        width,
        height * 0.39,
        12,
        fontRegular,
        rgb(0.28, 0.33, 0.42),
      );

      const footerColor = rgb(0.25, 0.3, 0.38);
      page.drawText(`Certificate ID: ${input.certificateId}`, {
        x: 48,
        y: 40,
        size: 11,
        font: fontRegular,
        color: footerColor,
      });
      page.drawText('Verified by CogniCare', {
        x: width - 180,
        y: 40,
        size: 11,
        font: fontRegular,
        color: footerColor,
      });
      page.drawText(`Quiz Score: ${quizScoreText}`, {
        x: 48,
        y: 57,
        size: 10,
        font: fontRegular,
        color: footerColor,
      });
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  private async _generateCertificatePdfFromHtml(input: {
    fullName: string;
    certificateId: string;
    issuedAt: Date;
    organizationName?: string;
    supervisorName?: string;
    authorityName?: string;
    quizScorePercent?: number;
  }): Promise<Buffer | null> {
    const htmlTemplatePath = await this._resolveCertificateHtmlTemplatePath();
    if (!htmlTemplatePath) {
      return null;
    }

    const fullName = this._safeCertificateText(input.fullName, 80);
    const organization = this._safeCertificateText(
      input.organizationName?.trim() || 'CogniCare Partner Organization',
      80,
    );
    const supervisor = this._safeCertificateText(
      input.supervisorName?.trim() || 'Organization Supervisor',
      70,
    );
    const authority = this._safeCertificateText(
      input.authorityName?.trim() || 'CogniCare Certification Authority',
      70,
    );
    const issueDate = input.issuedAt.toISOString().slice(0, 10);
    const quizScoreText =
      typeof input.quizScorePercent === 'number'
        ? `${Math.max(0, Math.min(100, Math.round(input.quizScorePercent)))}%`
        : 'N/A';

    const rawTemplate = await fs.readFile(htmlTemplatePath, 'utf8');
    const html = this._renderCertificateHtml(rawTemplate, {
      fullName,
      organization,
      supervisor,
      authority,
      issueDate,
      certificateId: input.certificateId,
      quizScore: quizScoreText,
    });

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
      browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `HTML certificate generation failed, fallback to legacy renderer: ${message}`,
      );
      return null;
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private _renderCertificateHtml(
    template: string,
    vars: {
      fullName: string;
      organization: string;
      supervisor: string;
      authority: string;
      issueDate: string;
      certificateId: string;
      quizScore: string;
    },
  ): string {
    const tokens: Record<string, string> = {
      '{{FULL_NAME}}': this._escapeHtml(vars.fullName),
      '{{ORGANIZATION}}': this._escapeHtml(vars.organization),
      '{{SUPERVISOR_NAME}}': this._escapeHtml(vars.supervisor),
      '{{AUTHORITY_NAME}}': this._escapeHtml(vars.authority),
      '{{ISSUE_DATE}}': this._escapeHtml(vars.issueDate),
      '{{CERTIFICATE_ID}}': this._escapeHtml(vars.certificateId),
      '{{QUIZ_SCORE}}': this._escapeHtml(vars.quizScore),
    };

    let rendered = template;
    for (const [token, value] of Object.entries(tokens)) {
      rendered = rendered.split(token).join(value);
    }
    return rendered;
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private _drawCenteredText(
    page: PDFPage,
    text: string,
    pageWidth: number,
    y: number,
    size: number,
    font: PDFFont,
    color: RGB,
  ): void {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: Math.max(20, (pageWidth - textWidth) / 2),
      y,
      size,
      font,
      color,
    });
  }

  private _drawCenteredLines(
    page: PDFPage,
    lines: string[],
    pageWidth: number,
    startY: number,
    size: number,
    lineHeight: number,
    font: PDFFont,
    color: RGB,
  ): void {
    let y = startY;
    for (const line of lines) {
      this._drawCenteredText(page, line, pageWidth, y, size, font, color);
      y -= lineHeight;
    }
  }

  private async _storeCertificateBuffer(
    userId: string,
    certificateId: string,
    pdfBuffer: Buffer,
  ): Promise<string> {
    if (this.cloudinary.isConfigured()) {
      return this.cloudinary.uploadRawBuffer(pdfBuffer, {
        folder: 'cognicare/certificates',
        publicId: `caregiver_certificate_${userId}_${Date.now()}`,
        resourceType: 'raw',
      });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'certificates');
    await fs.mkdir(uploadsDir, { recursive: true });
    const safeId = certificateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeId}.pdf`;
    const filePath = path.join(uploadsDir, filename);
    await fs.writeFile(filePath, pdfBuffer);
    return `/uploads/certificates/${filename}`;
  }

  private async _fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async _resolveCertificateTemplatePath(): Promise<string | null> {
    const configuredPath =
      process.env.CAREGIVER_CERTIFICATE_TEMPLATE_PATH?.trim();
    if (configuredPath && (await this._fileExists(configuredPath))) {
      return configuredPath;
    }

    const candidates = [
      DEFAULT_CERT_TEMPLATE_ALT_PDF_PATH,
      DEFAULT_CERT_TEMPLATE_PATH,
      DEFAULT_CERT_TEMPLATE_PNG_PATH,
      DEFAULT_CERT_TEMPLATE_JPG_PATH,
    ];
    for (const candidate of candidates) {
      if (await this._fileExists(candidate)) return candidate;
    }
    return null;
  }

  private async _resolveCertificateHtmlTemplatePath(): Promise<string | null> {
    const configuredPath =
      process.env.CAREGIVER_CERTIFICATE_TEMPLATE_PATH?.trim();
    if (
      configuredPath &&
      configuredPath.toLowerCase().endsWith('.html') &&
      (await this._fileExists(configuredPath))
    ) {
      return configuredPath;
    }

    if (await this._fileExists(DEFAULT_CERT_TEMPLATE_HTML_PATH)) {
      return DEFAULT_CERT_TEMPLATE_HTML_PATH;
    }
    return null;
  }

  private async _getCertificateDynamicFields(
    userId: string,
    app: VolunteerApplication,
  ): Promise<{
    supervisorName: string;
    authorityName: string;
    quizScorePercent?: number;
  }> {
    const authorityName =
      this._safeCertificateText(
        process.env.CAREGIVER_CERTIFICATE_AUTHORITY_NAME?.trim() ||
          'CogniCare Certification Authority',
        70,
      ) || 'CogniCare Certification Authority';

    let supervisorName = app.organizationRole?.trim();
    if (!supervisorName && app.reviewedBy) {
      const reviewer = await this.userModel
        .findById(app.reviewedBy)
        .select('fullName')
        .lean()
        .exec();
      supervisorName = reviewer?.fullName?.trim();
    }
    if (!supervisorName && app.organizationName?.trim()) {
      supervisorName = `${app.organizationName.trim()} Supervisor`;
    }
    if (!supervisorName) {
      supervisorName = 'Organization Supervisor';
    }

    const latestPassedAttempt = await this.certificationAttemptModel
      .findOne({
        userId: new Types.ObjectId(userId),
        passed: true,
      })
      .sort({ createdAt: -1 })
      .select('scorePercent')
      .lean()
      .exec();

    const scorePercentRaw =
      latestPassedAttempt &&
      typeof (latestPassedAttempt as { scorePercent?: unknown })
        .scorePercent === 'number'
        ? (latestPassedAttempt as { scorePercent: number }).scorePercent
        : undefined;

    return {
      supervisorName: this._safeCertificateText(supervisorName, 70),
      authorityName,
      quizScorePercent: scorePercentRaw,
    };
  }

  private _safeCertificateText(value: string, maxLength: number): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    const ascii = compact.normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
    return ascii.slice(0, maxLength) || 'N/A';
  }

  private toResponse(
    app: Record<string, unknown>,
    includeUser = false,
    user?: {
      role?: string;
      careProviderType?: string;
      specialty?: string;
    } | null,
  ): Record<string, unknown> {
    const id = (app._id as { toString(): string })?.toString?.();
    const userIdRaw = app.userId;
    const userIdStr =
      userIdRaw && typeof userIdRaw === 'object' && '_id' in userIdRaw
        ? (userIdRaw as { _id: { toString(): string } })._id?.toString?.()
        : (userIdRaw as Types.ObjectId)?.toString?.();
    const documents = (app.documents ?? []) as unknown[];
    const status = app.status as string | undefined;
    const hasDocuments = documents.length >= 1;
    const approvedWithType =
      status === 'approved' && userHasCareProviderType(user ?? null);
    const profileComplete = hasDocuments || approvedWithType;
    const careProviderType = effectiveCareProviderType(
      app.careProviderType as string | undefined,
      user ?? null,
    );
    const specialty = (app.specialty as string | undefined) ?? user?.specialty;
    const doc: Record<string, unknown> = {
      id,
      userId: userIdStr,
      status: app.status,
      careProviderType: careProviderType ?? app.careProviderType,
      specialty: specialty ?? app.specialty,
      organizationName: app.organizationName,
      organizationRole: app.organizationRole,
      documents: app.documents ?? [],
      profileComplete,
      trainingCertified: app.trainingCertified ?? false,
      trainingCertifiedAt: app.trainingCertifiedAt,
      certificationCertificateUrl: app.certificationCertificateUrl,
      certificationCertificateId: app.certificationCertificateId,
      certificationIssuedAt: app.certificationIssuedAt,
      deniedReason: app.deniedReason,
      reviewedBy: (app.reviewedBy as Types.ObjectId)?.toString?.(),
      reviewedAt: app.reviewedAt,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
    if (includeUser && userIdRaw && typeof userIdRaw === 'object') {
      doc.user = userIdRaw;
    }
    return doc;
  }

  /**
   * Specialist or admin assigns a task to a volunteer. Sends notification to volunteer.
   */
  async assignTask(
    assignedByUserId: string,
    dto: {
      volunteerId: string;
      title: string;
      description?: string;
      dueDate?: string;
    },
  ) {
    if (!dto.title?.trim()) {
      throw new BadRequestException('Title is required');
    }
    const task = await this.volunteerTaskModel.create({
      assignedBy: new Types.ObjectId(assignedByUserId),
      volunteerId: new Types.ObjectId(dto.volunteerId),
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      status: 'pending',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
    });
    await this.notifications.createForUser(dto.volunteerId, {
      type: 'volunteer_task_assigned',
      title: 'Nouvelle tâche assignée',
      description: dto.title.trim(),
      data: {
        taskId: (task as unknown as { _id: Types.ObjectId })._id?.toString?.(),
        assignedBy: assignedByUserId,
      },
    });
    return this.formatTask(task);
  }

  /** Volunteer lists their assigned tasks. */
  async getMyTasks(volunteerId: string) {
    const list = await this.volunteerTaskModel
      .find({ volunteerId: new Types.ObjectId(volunteerId) })
      .populate('assignedBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return list.map((t) =>
      this.formatTask(
        t as VolunteerTask & {
          _id: Types.ObjectId;
          assignedBy?: { fullName?: string };
        },
      ),
    );
  }

  private formatTask(
    t: VolunteerTask & {
      _id: Types.ObjectId;
      assignedBy?: { fullName?: string } | Types.ObjectId;
    },
  ) {
    const assignedBy = t.assignedBy;
    const name =
      assignedBy && typeof assignedBy === 'object' && 'fullName' in assignedBy
        ? (assignedBy as { fullName?: string }).fullName
        : undefined;
    return {
      id: t._id?.toString?.(),
      volunteerId: t.volunteerId?.toString?.(),
      assignedBy: (t.assignedBy as Types.ObjectId)?.toString?.(),
      assignedByName: name,
      title: t.title,
      description: t.description,
      status: t.status,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
    };
  }

  private calculateHoursBetween(
    startTime?: string,
    endTime?: string,
  ): number {
    const startMinutes = this.timeStringToMinutes(startTime);
    const endMinutes = this.timeStringToMinutes(endTime);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      return 0;
    }
    return (endMinutes - startMinutes) / 60;
  }

  private timeStringToMinutes(value?: string): number | null {
    if (!value) return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  private buildAvailabilitySummary(
    availabilityDocs: Array<Record<string, unknown>>,
  ): VolunteerProfileAvailabilitySummary {
    const todayIso = new Date().toISOString().slice(0, 10);
    const futureDates = availabilityDocs.flatMap((availabilityDoc) => {
      const dates = availabilityDoc.dates;
      if (!Array.isArray(dates)) return [] as string[];
      return dates
        .map((value) => value?.toString())
        .filter((date): date is string => Boolean(date) && date >= todayIso);
    });
    futureDates.sort((left, right) => left.localeCompare(right));
    const recurringSlotsCount = availabilityDocs.filter((availabilityDoc) => {
      return availabilityDoc.recurrenceOn === true;
    }).length;
    return {
      active: recurringSlotsCount > 0 || futureDates.length > 0,
      upcomingDatesCount: futureDates.length,
      recurringSlotsCount,
      nextDate: futureDates.length === 0 ? null : futureDates[0],
    };
  }

  private buildCompetencies(args: {
    user: Record<string, unknown> | null;
    application: Record<string, unknown> | null;
    stats: VolunteerProfileStatSummary;
    availability: VolunteerProfileAvailabilitySummary;
    enrollments: Array<Record<string, unknown>>;
  }): VolunteerProfileCompetencySummary[] {
    const items: VolunteerProfileCompetencySummary[] = [];
    const pushUnique = (item: VolunteerProfileCompetencySummary): void => {
      if (items.some((existing) => existing.id == item.id)) return;
      items.push(item);
    };

    const careProviderType =
      args.application?['careProviderType']?.toString() ??
      args.user?['careProviderType']?.toString() ??
      args.user?['role']?.toString();
    if (careProviderType) {
      pushUnique({
        id: 'care-role',
        label: this.formatCareProviderTypeLabel(careProviderType),
        source: 'Parcours',
        reason: 'Issu de votre profil soignant et de votre parcours d’onboarding.',
      });
    }

    const specialty =
      args.application?['specialty']?.toString() ??
      args.user?['specialty']?.toString();
    if (specialty != null && specialty.trim().length > 0) {
      pushUnique({
        id: 'specialty',
        label: specialty.trim(),
        source: 'Spécialisation',
        reason: 'Déclarée dans votre profil et utilisée pour personnaliser vos missions.',
      });
    }

    if (args.stats.completedCourses > 0) {
      pushUnique({
        id: 'training',
        label: 'Formation complétée',
        source: 'Apprentissage',
        reason: `${args.stats.completedCourses} formation(s) terminée(s) dans l’app.`,
      });
    }

    if ((args.application?['trainingCertified'] as bool? ?? false) == true) {
      pushUnique({
        id: 'certified',
        label: 'Certification validée',
        source: 'Reconnaissance',
        reason: 'Certification obtenue après validation du parcours qualifiant.',
      });
    }

    if (args.stats.completedAppointments > 0) {
      pushUnique({
        id: 'field-support',
        label: 'Accompagnement terrain',
        source: 'Missions',
        reason:
            '${args.stats.completedAppointments} mission(s) d’accompagnement réalisées avec des familles.',
      });
    }

    if (args.stats.completedTasks > 0) {
      pushUnique({
        id: 'task-followthrough',
        label: 'Suivi de mission',
        source: 'Fiabilité',
        reason:
            '${args.stats.completedTasks} tâche(s) finalisée(s) dans votre parcours de bénévole.',
      });
    }

    if (args.availability.active) {
      pushUnique({
        id: 'availability',
        label: 'Disponibilité active',
        source: 'Engagement',
        reason:
            'Votre agenda contient des créneaux publiés pour de futures missions.',
      });
    }

    if (args.stats.serviceHours >= 10) {
      pushUnique({
        id: 'consistency',
        label: 'Présence régulière',
        source: 'Impact',
        reason: 'Votre temps de service cumulé montre une implication durable.',
      });
    }

    return items.slice(0, 6);
  }

  private buildBadges(args: {
    stats: VolunteerProfileStatSummary;
    availability: VolunteerProfileAvailabilitySummary;
    trainingCertified: boolean;
    completedCourses: number;
  }): VolunteerProfileBadgeSummary[] {
    return [
      this.createBadge({
        id: 'mission-builder',
        label: 'Missions',
        description: 'Se débloque en accomplissant des missions et des tâches.',
        currentValue: args.stats.missionsCompleted,
        unlockTarget: 1,
        advanceTarget: 10,
      }),
      this.createBadge({
        id: 'steady-support',
        label: 'Présence',
        description: 'Progresse avec vos heures de service réellement accomplies.',
        currentValue: Math.round(args.stats.serviceHours),
        unlockTarget: 5,
        advanceTarget: 20,
      }),
      this.createBadge({
        id: 'certified-guide',
        label: 'Certification',
        description: 'Récompense la formation validée et sa mise en pratique.',
        currentValue:
            (args.trainingCertified ? 1 : 0) +
            (args.completedCourses >= 2 ? 1 : 0) +
            (args.availability.active ? 1 : 0),
        unlockTarget: 1,
        advanceTarget: 3,
      }),
    ];
  }

  private createBadge(args: {
    id: string;
    label: string;
    description: string;
    currentValue: number;
    unlockTarget: number;
    advanceTarget: number;
  }): VolunteerProfileBadgeSummary {
    const state: BadgeState =
      args.currentValue >= args.advanceTarget
        ? 'advanced'
        : args.currentValue >= args.unlockTarget
          ? 'unlocked'
          : 'locked';
    const nextTarget =
      state == 'locked'
        ? args.unlockTarget
        : state == 'unlocked'
          ? args.advanceTarget
          : null;
    const progressBase =
      state == 'locked'
        ? Math.min(args.currentValue / args.unlockTarget, 1)
        : Math.min(args.currentValue / args.advanceTarget, 1);
    return {
      id: args.id,
      label: args.label,
      description: args.description,
      state,
      progressPercent: Math.round(progressBase * 100),
      currentValue: args.currentValue,
      nextTarget,
    };
  }

  private buildImpact(args: {
    stats: VolunteerProfileStatSummary;
    trainingCertified: boolean;
    availability: VolunteerProfileAvailabilitySummary;
  }): VolunteerProfileImpactSummary {
    const milestones = [
      { label: 'Élan', min: 0, max: 119 },
      { label: 'Engagé', min: 120, max: 259 },
      { label: 'Pilier', min: 260, max: 479 },
      { label: 'Référence', min: 480, max: null },
    ] as const;
    const current =
      milestones.find((milestone) => {
        return milestone.max == null
          ? args.stats.totalPoints >= milestone.min
          : args.stats.totalPoints >= milestone.min &&
              args.stats.totalPoints <= milestone.max;
      }) ?? milestones[0];
    const next =
      milestones.find((milestone) => milestone.min > current.min) ?? null;
    const progressPercent =
      current.max == null
        ? 100
        : Math.round(
            Math.max(
              0,
              Math.min(
                100,
                ((args.stats.totalPoints - current.min) /
                  (current.max - current.min + 1)) *
                  100,
              ),
            ),
          );
    const summaryParts = <string>[];
    if (args.stats.missionsCompleted > 0) {
      summaryParts.add('${args.stats.missionsCompleted} mission(s) validée(s)');
    }
    if (args.stats.serviceHours > 0) {
      summaryParts.add('${args.stats.serviceHours} h de service');
    }
    if (args.trainingCertified) {
      summaryParts.add('certification obtenue');
    }
    if (args.availability.active) {
      summaryParts.add('agenda actif');
    }
    return {
      score: args.stats.totalPoints,
      level: current.label,
      summary:
        summaryParts.length === 0
          ? 'Votre impact commencera à se construire dès vos premières actions validées.'
          : summaryParts.join(' • '),
      progressPercent: progressPercent,
      nextLevelLabel: next?.label ?? null,
    };
  }

  private buildStoryline(args: {
    application: Record<string, unknown> | null;
    stats: VolunteerProfileStatSummary;
    availability: VolunteerProfileAvailabilitySummary;
    trainingCertified: boolean;
  }): string {
    const fragments: string[] = [];
    const specialty = args.application?['specialty']?.toString();
    if (specialty != null && specialty.trim().length > 0) {
      fragments.add('Spécialisation: ${specialty.trim()}');
    }
    if (args.trainingCertified) {
      fragments.add('parcours certifié');
    }
    if (args.stats.missionsCompleted > 0) {
      fragments.add('${args.stats.missionsCompleted} mission(s) validée(s)');
    }
    if (args.stats.serviceHours > 0) {
      fragments.add('${args.stats.serviceHours} h de service cumulées');
    }
    if (args.availability.active) {
      fragments.add('disponibilités publiées');
    }
    if (fragments.length === 0) {
      return 'Votre profil évoluera automatiquement à mesure que vous terminez des missions, publiez vos disponibilités et validez vos formations.';
    }
    return fragments.join(' • ');
  }

  private resolveRoleLabel(
    user: Record<string, unknown> | null,
    application: Record<string, unknown> | null,
  ): string {
    const role =
      application?['careProviderType']?.toString() ??
      user?['careProviderType']?.toString() ??
      user?['role']?.toString() ??
      'volunteer';
    return this.formatCareProviderTypeLabel(role);
  }

  private formatCareProviderTypeLabel(value: string): string {
    const normalized = value.trim().toLowerCase();
    const labels: Record<string, string> = {
      volunteer: 'Bénévole',
      careprovider: 'Aidant',
      caregiver: 'Aidant',
      doctor: 'Médecin',
      psychologist: 'Psychologue',
      speech_therapist: 'Orthophoniste',
      occupational_therapist: 'Ergothérapeute',
      ergotherapist: 'Ergothérapeute',
      organization_leader: 'Responsable d’organisation',
      other: 'Professionnel engagé',
    };
    return labels[normalized] ?? value;
  }
}
