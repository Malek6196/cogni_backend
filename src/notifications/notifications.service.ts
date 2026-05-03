import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChildrenService } from '../children/children.service';
import { RemindersService } from '../nutrition/reminders.service';

export type NotificationLean = Notification & { _id: Types.ObjectId };

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly childrenService: ChildrenService,
    private readonly remindersService: RemindersService,
  ) {}

  async listForUser(userId: string, limit = 50): Promise<NotificationLean[]> {
    const list = await this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return list as NotificationLean[];
  }

  async countUnread(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        read: false,
      })
      .exec();
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(notificationId),
          userId: new Types.ObjectId(userId),
        },
        { $set: { read: true } },
      )
      .exec();
    if (!updated) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        { userId: new Types.ObjectId(userId) },
        { $set: { read: true } },
      )
      .exec();
  }

  /** Supprime la notification de type follow_request liée à ce requestId pour cet utilisateur. */
  async deleteByFollowRequestId(
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.notificationModel
      .deleteMany({
        userId: new Types.ObjectId(userId),
        type: 'follow_request',
        'data.requestId': requestId,
      })
      .exec();
  }

  async createForUser(
    userId: string,
    payload: {
      type: string;
      title: string;
      description?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<NotificationLean> {
    const doc = await this.notificationModel.create({
      userId: new Types.ObjectId(userId),
      type: payload.type,
      title: payload.title,
      description: payload.description ?? '',
      read: false,
      data: payload.data ?? undefined,
    });
    return doc.toObject() as NotificationLean;
  }

  async syncRoutineReminders(userId: string): Promise<void> {
    const children = await this.childrenService.findByFamilyId(userId, userId);
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    for (const child of children) {
      const reminders = await this.remindersService.getTodayReminders(
        child.id,
        userId,
      );

      for (const reminder of reminders) {
        if (reminder.times && reminder.times.length > 0) {
          for (const timeStr of reminder.times) {
            const [hour, minute] = timeStr.split(':').map(Number);

            // Si l'heure est passée
            if (
              hour < currentHour ||
              (hour === currentHour && minute <= currentMinute)
            ) {
              // Vérifier si une notification existe déjà pour ce rappel à cette heure précise aujourd'hui
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);

              const exists = await this.notificationModel
                .findOne({
                  userId: new Types.ObjectId(userId),
                  type: 'routine_reminder',
                  'data.reminderId': reminder.id,
                  'data.time': timeStr,
                  createdAt: { $gte: todayStart },
                })
                .exec();

              if (!exists) {
                await this.createForUser(userId, {
                  type: 'routine_reminder',
                  title: reminder.title,
                  description:
                    reminder.description ||
                    `C'est l'heure de votre tâche : ${reminder.title}`,
                  data: {
                    reminderId: reminder.id,
                    time: timeStr,
                    childId: child.id,
                    childName: child.fullName,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  async syncProviderAppointmentNotifications(userId: string): Promise<void> {
    const existing = await this.notificationModel
      .find({
        userId: new Types.ObjectId(userId),
        type: 'appointment_new',
      })
      .select('data.appointmentId')
      .lean()
      .exec();

    const existingAppointmentIds = new Set(
      (existing as Array<{ data?: { appointmentId?: string } }>)
        .map((notification) => notification.data?.appointmentId)
        .filter(
          (appointmentId): appointmentId is string =>
            typeof appointmentId === 'string' && appointmentId.length > 0,
        ),
    );

    const appointments = await this.appointmentModel
      .find({
        providerId: new Types.ObjectId(userId),
        status: { $ne: 'cancelled' },
      })
      .select('_id userId childName date startTime')
      .sort({ createdAt: -1 })
      .limit(25)
      .lean()
      .exec();

    const appointmentRows = appointments as Array<{
      _id?: Types.ObjectId;
      userId?: Types.ObjectId;
      childName?: string;
      date?: string;
      startTime?: string;
    }>;

    const requesterIds = Array.from(
      new Set(
        appointmentRows
          .map((appointment) => appointment.userId?.toString())
          .filter((value): value is string => typeof value === 'string'),
      ),
    );

    const requesters = await this.userModel
      .find({
        _id: { $in: requesterIds.map((id) => new Types.ObjectId(id)) },
      })
      .select('fullName')
      .lean()
      .exec();

    const requesterNameById = new Map<string, string>();
    for (const requester of requesters as Array<{
      _id?: Types.ObjectId;
      fullName?: string;
    }>) {
      if (requester._id) {
        requesterNameById.set(
          requester._id.toString(),
          requester.fullName ?? 'Un parent',
        );
      }
    }

    for (const appointment of appointmentRows) {
      const appointmentId = appointment._id?.toString();
      if (!appointmentId || existingAppointmentIds.has(appointmentId)) continue;

      const requesterName = appointment.userId
        ? (requesterNameById.get(appointment.userId.toString()) ?? 'Un parent')
        : 'Un parent';
      const childName = appointment.childName?.trim();

      await this.createForUser(userId, {
        type: 'appointment_new',
        title: 'Nouveau rendez-vous',
        description:
          childName != null && childName.length > 0
            ? `Nouveau rendez-vous pris par ${requesterName} pour ${childName} le ${appointment.date} à ${appointment.startTime}`
            : `Nouveau rendez-vous pris par ${requesterName} le ${appointment.date} à ${appointment.startTime}`,
        data: {
          appointmentId,
          childName,
          requesterName,
        },
      });
      existingAppointmentIds.add(appointmentId);
    }
  }
}
