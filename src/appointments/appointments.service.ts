import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Appointment,
  AppointmentDocument,
  AppointmentStatus,
} from './schemas/appointment.schema';
import {
  CancelAppointmentDto,
  CompleteAppointmentDto,
  CreateAppointmentDto,
  RateAppointmentDto,
} from './dto/create-appointment.dto';
import { ConsultationSlotsService } from '../consultation-slots/consultation-slots.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { AppointmentsGateway } from './gateways/appointments.gateway';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    private readonly slotsService: ConsultationSlotsService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly gateway: AppointmentsGateway,
  ) {}

  /** Book a consultation slot – atomic, race-condition-safe */
  async createAppointment(
    userId: string,
    userEmail: string,
    userFullName: string,
    dto: CreateAppointmentDto,
  ): Promise<any> {
    const lockedSlot = await this.slotsService.lockSlot(dto.slotId);
    if (!lockedSlot) {
      throw new ConflictException(
        'This slot is no longer available. Please select another.',
      );
    }

    const bookingRef = await this.generateBookingRef();

    const doc = await this.appointmentModel.create({
      userId: new Types.ObjectId(userId),
      providerId: lockedSlot.providerId,
      slotId: lockedSlot._id,
      consultationType: lockedSlot.consultationType,
      status: 'confirmed',
      date: lockedSlot.date,
      startTime: lockedSlot.startTime,
      endTime: lockedSlot.endTime,
      reason: dto.reason,
      preferredLanguage: dto.preferredLanguage ?? 'fr',
      notes: dto.notes,
      childId: dto.childId ? new Types.ObjectId(dto.childId) : undefined,
      childName: dto.childName,
      mode: dto.mode ?? lockedSlot.mode ?? 'both',
      bookingRef,
      confirmationSent: false,
    });

    const populated = await this.appointmentModel
      .findById(doc._id)
      .populate('providerId', 'fullName profilePic specialty email')
      .populate('slotId', 'date startTime endTime mode')
      .lean();

    const formatted = this.formatAppointment(populated);

    // Emit real-time slot update
    this.gateway.emitSlotUpdate(lockedSlot.providerId.toString(), {
      slotId: lockedSlot._id.toString(),
      status: 'booked',
      date: lockedSlot.date,
      startTime: lockedSlot.startTime,
      endTime: lockedSlot.endTime,
    });

    // Send in-app notification to user
    await this.notificationsService.createForUser(userId, {
      type: 'appointment_confirmed',
      title: 'Consultation confirmée',
      description: `Votre consultation du ${lockedSlot.date} à ${lockedSlot.startTime} a été confirmée. Réf: ${bookingRef}`,
      data: { appointmentId: doc._id.toString(), bookingRef },
    });

    // Send in-app notification to provider
    await this.notificationsService.createForUser(
      lockedSlot.providerId.toString(),
      {
        type: 'appointment_new',
        title: 'Nouveau rendez-vous',
        description: `Nouveau rendez-vous réservé le ${lockedSlot.date} à ${lockedSlot.startTime}`,
        data: { appointmentId: doc._id.toString(), bookingRef },
      },
    );

    // Send confirmation email (best-effort)
    this.mailService
      .sendBookingConfirmation(userEmail, {
        userName: userFullName,
        bookingRef,
        date: lockedSlot.date,
        startTime: lockedSlot.startTime,
        endTime: lockedSlot.endTime,
        consultationType: lockedSlot.consultationType,
        providerName: (populated?.providerId as any)?.fullName ?? 'Provider',
        preferredLanguage: dto.preferredLanguage ?? 'fr',
        mode: dto.mode ?? 'both',
      })
      .catch(() => {
        /* best-effort */
      });

    await this.appointmentModel.findByIdAndUpdate(doc._id, {
      confirmationSent: true,
    });

    return formatted;
  }

  /** Cancel an appointment */
  async cancelAppointment(
    appointmentId: string,
    actorId: string,
    actorRole: string,
    dto: CancelAppointmentDto,
  ): Promise<any> {
    const appointment = await this.appointmentModel.findById(appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');

    if (actorRole !== 'admin') {
      const isUser = appointment.userId.toString() === actorId;
      const isProvider = appointment.providerId.toString() === actorId;
      if (!isUser && !isProvider) {
        throw new ForbiddenException(
          'You are not authorized to cancel this appointment',
        );
      }
    }

    if (['cancelled', 'completed'].includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot cancel an appointment with status: ${appointment.status}`,
      );
    }

    const cancelledBy =
      actorRole === 'admin'
        ? 'admin'
        : appointment.userId.toString() === actorId
          ? 'user'
          : 'provider';

    await this.appointmentModel.findByIdAndUpdate(appointmentId, {
      status: 'cancelled',
      cancellationReason: dto.reason,
      cancelledBy,
      cancelledAt: new Date(),
    });

    // Release the slot
    await this.slotsService.releaseSlot(appointment.slotId.toString());

    // Real-time update
    this.gateway.emitAppointmentCancelled(
      appointment.userId.toString(),
      appointment.providerId.toString(),
      appointment.slotId.toString(),
    );

    // Notify user
    await this.notificationsService.createForUser(
      appointment.userId.toString(),
      {
        type: 'appointment_cancelled',
        title: 'Rendez-vous annulé',
        description: `Votre consultation du ${appointment.date} à ${appointment.startTime} a été annulée.`,
        data: { appointmentId, cancelledBy, reason: dto.reason },
      },
    );

    return { message: 'Appointment cancelled successfully' };
  }

  /** Mark appointment as completed (provider only) */
  async completeAppointment(
    appointmentId: string,
    providerId: string,
    dto: CompleteAppointmentDto,
  ): Promise<any> {
    const appointment = await this.appointmentModel.findById(appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.providerId.toString() !== providerId) {
      throw new ForbiddenException(
        'Only the assigned provider can complete this appointment',
      );
    }
    if (appointment.status !== 'confirmed') {
      throw new BadRequestException(
        'Only confirmed appointments can be completed',
      );
    }

    await this.appointmentModel.findByIdAndUpdate(appointmentId, {
      status: 'completed',
      providerNotes: dto.providerNotes,
    });

    await this.notificationsService.createForUser(
      appointment.userId.toString(),
      {
        type: 'appointment_completed',
        title: 'Consultation terminée',
        description: `Votre consultation du ${appointment.date} est terminée. N'hésitez pas à laisser un avis.`,
        data: { appointmentId },
      },
    );

    return { message: 'Appointment marked as completed' };
  }

  /** Rate a completed appointment (user only) */
  async rateAppointment(
    appointmentId: string,
    userId: string,
    dto: RateAppointmentDto,
  ): Promise<any> {
    const appointment = await this.appointmentModel.findById(appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.userId.toString() !== userId) {
      throw new ForbiddenException('You can only rate your own appointments');
    }
    if (appointment.status !== 'completed') {
      throw new BadRequestException('You can only rate completed appointments');
    }

    await this.appointmentModel.findByIdAndUpdate(appointmentId, {
      userRating: dto.rating,
      userFeedback: dto.feedback,
    });
    return { message: 'Rating submitted successfully' };
  }

  /** Get appointments for the logged-in user (family) */
  async listUserAppointments(
    userId: string,
    status?: AppointmentStatus,
  ): Promise<any[]> {
    const filter: FilterQuery<AppointmentDocument> = {
      userId: new Types.ObjectId(userId),
    };
    if (status) filter.status = status;

    const docs = await this.appointmentModel
      .find(filter)
      .populate('providerId', 'fullName profilePic specialty role')
      .populate('slotId', 'consultationType mode')
      .sort({ date: -1, startTime: -1 })
      .lean();

    return docs.map((d: unknown) => this.formatAppointment(d));
  }

  /** Get appointments for a provider */
  async listProviderAppointments(
    providerId: string,
    status?: AppointmentStatus,
    date?: string,
  ): Promise<any[]> {
    const filter: FilterQuery<AppointmentDocument> = {
      providerId: new Types.ObjectId(providerId),
    };
    if (status) filter.status = status;
    if (date) filter.date = date;

    const docs = await this.appointmentModel
      .find(filter)
      .populate('userId', 'fullName profilePic email phone')
      .populate('slotId', 'consultationType mode')
      .sort({ date: 1, startTime: 1 })
      .lean();

    return docs.map((d: unknown) => this.formatAppointment(d));
  }

  /** Get a single appointment by ID */
  async getAppointmentById(
    appointmentId: string,
    actorId: string,
    actorRole: string,
  ): Promise<any> {
    const doc = await this.appointmentModel
      .findById(appointmentId)
      .populate('providerId', 'fullName profilePic specialty role email phone')
      .populate('userId', 'fullName profilePic email')
      .populate('slotId', 'consultationType mode note')
      .lean();

    if (!doc) throw new NotFoundException('Appointment not found');

    const isUser =
      doc.userId &&
      (
        doc.userId as unknown as { _id?: { toString(): string } }
      )._id?.toString() === actorId;
    const isProvider =
      doc.providerId &&
      (
        doc.providerId as unknown as { _id?: { toString(): string } }
      )._id?.toString() === actorId;

    if (actorRole !== 'admin' && !isUser && !isProvider) {
      throw new ForbiddenException(
        'You are not authorized to view this appointment',
      );
    }

    return this.formatAppointment(doc);
  }

  /** Admin: list all appointments */
  async adminListAppointments(filters: {
    status?: string;
    consultationType?: string;
    date?: string;
    userId?: string;
    providerId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const filter: FilterQuery<AppointmentDocument> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.consultationType)
      filter.consultationType = filters.consultationType;
    if (filters.date) filter.date = filters.date;
    if (filters.userId) filter.userId = new Types.ObjectId(filters.userId);
    if (filters.providerId)
      filter.providerId = new Types.ObjectId(filters.providerId);

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      this.appointmentModel
        .find(filter)
        .populate('userId', 'fullName email role')
        .populate('providerId', 'fullName email specialty role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.appointmentModel.countDocuments(filter),
    ]);

    return {
      data: docs.map((d: unknown) => this.formatAppointment(d)),
      total,
      page,
      limit,
    };
  }

  /** Cron job: send reminders for upcoming appointments */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendUpcomingReminders() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // 24h reminders
    const upcoming24h = await this.appointmentModel.find({
      status: 'confirmed',
      date: tomorrowStr,
      reminder24hSent: false,
    });

    for (const appt of upcoming24h) {
      await this.notificationsService.createForUser(appt.userId.toString(), {
        type: 'appointment_reminder',
        title: 'Rappel de consultation',
        description: `Rappel : vous avez une consultation demain ${appt.date} à ${appt.startTime}. Réf: ${appt.bookingRef ?? ''}`,
        data: { appointmentId: appt._id.toString(), hoursUntil: 24 },
      });
      await this.appointmentModel.findByIdAndUpdate(appt._id, {
        reminder24hSent: true,
      });
    }

    // 2h reminders
    const twoHoursLaterH = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const targetTime = `${twoHoursLaterH.getHours().toString().padStart(2, '0')}:${twoHoursLaterH.getMinutes().toString().padStart(2, '0')}`;

    const upcoming2h = await this.appointmentModel.find({
      status: 'confirmed',
      date: todayStr,
      startTime: targetTime,
      reminder2hSent: false,
    });

    for (const appt of upcoming2h) {
      await this.notificationsService.createForUser(appt.userId.toString(), {
        type: 'appointment_reminder',
        title: 'Consultation dans 2 heures',
        description: `Votre consultation commence dans 2 heures à ${appt.startTime}. Réf: ${appt.bookingRef ?? ''}`,
        data: { appointmentId: appt._id.toString(), hoursUntil: 2 },
      });
      await this.appointmentModel.findByIdAndUpdate(appt._id, {
        reminder2hSent: true,
      });
    }
  }

  private async generateBookingRef(): Promise<string> {
    const count = await this.appointmentModel.countDocuments();
    const year = new Date().getFullYear();
    return `BK-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  formatAppointment(d: unknown): Record<string, unknown> | null {
    if (!d) return null;
    const doc = d as Record<string, unknown>;
    const provider = doc.providerId as Record<string, unknown> | undefined;
    const user = doc.userId as Record<string, unknown> | undefined;
    const slot = doc.slotId as Record<string, unknown> | undefined;
    return {
      id: (doc._id as { toString(): string })?.toString(),
      bookingRef: doc.bookingRef,
      userId:
        typeof user === 'object'
          ? (user._id as { toString(): string })?.toString()
          : (user as unknown as { toString(): string })?.toString(),
      userName: typeof user === 'object' ? user.fullName : undefined,
      userProfilePic: typeof user === 'object' ? user.profilePic : undefined,
      userEmail: typeof user === 'object' ? user.email : undefined,
      providerId:
        typeof provider === 'object'
          ? (provider._id as { toString(): string })?.toString()
          : (provider as unknown as { toString(): string })?.toString(),
      providerName:
        typeof provider === 'object' ? provider.fullName : undefined,
      providerProfilePic:
        typeof provider === 'object' ? provider.profilePic : undefined,
      providerSpecialty:
        typeof provider === 'object' ? provider.specialty : undefined,
      providerRole: typeof provider === 'object' ? provider.role : undefined,
      slotId:
        typeof slot === 'object'
          ? (slot._id as { toString(): string })?.toString()
          : (slot as unknown as { toString(): string })?.toString(),
      consultationType: doc.consultationType,
      status: doc.status,
      date: doc.date,
      startTime: doc.startTime,
      endTime: doc.endTime,
      reason: doc.reason,
      preferredLanguage: doc.preferredLanguage,
      notes: doc.notes,
      childId: (doc.childId as { toString(): string })?.toString(),
      childName: doc.childName,
      mode: doc.mode,
      cancellationReason: doc.cancellationReason,
      cancelledBy: doc.cancelledBy,
      cancelledAt: doc.cancelledAt,
      providerNotes: doc.providerNotes,
      userRating: doc.userRating,
      userFeedback: doc.userFeedback,
      createdAt: doc.createdAt,
    };
  }
}
