import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import {
  ConsultationSlot,
  ConsultationSlotDocument,
  ConsultationType,
} from './schemas/consultation-slot.schema';
import {
  BulkCreateSlotsDto,
  BlockSlotDto,
  CreateConsultationSlotDto,
} from './dto/create-consultation-slot.dto';

const PROVIDER_ROLES = [
  'doctor',
  'volunteer',
  'organization_staff',
  'organization_leader',
  'careprovider',
  'psychologist',
  'speech_therapist',
  'occupational_therapist',
  'ergotherapist',
  'healthcare',
  'professional',
];

@Injectable()
export class ConsultationSlotsService {
  constructor(
    @InjectModel(ConsultationSlot.name)
    private readonly slotModel: Model<ConsultationSlotDocument>,
  ) {}

  private assertIsProvider(role: string): void {
    if (!PROVIDER_ROLES.includes(role.toLowerCase())) {
      throw new ForbiddenException(
        'Only providers can manage consultation slots',
      );
    }
  }

  /** Create a single slot */
  async createSlot(
    providerId: string,
    role: string,
    dto: CreateConsultationSlotDto,
  ): Promise<any> {
    this.assertIsProvider(role);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const existing = await this.slotModel.findOne({
      providerId: new Types.ObjectId(providerId),
      date: dto.date,
      startTime: dto.startTime,
      status: { $ne: 'blocked' },
    });
    if (existing) {
      throw new BadRequestException(
        'A slot already exists at this date and time',
      );
    }

    const doc = await this.slotModel.create({
      providerId: new Types.ObjectId(providerId),
      consultationType: dto.consultationType,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      durationMinutes: dto.durationMinutes ?? 30,
      note: dto.note,
      languages: dto.languages ?? [],
      mode: dto.mode ?? 'both',
      specialty: dto.specialty,
      status: 'available',
    });
    return this.formatSlot(doc.toObject());
  }

  /** Bulk-create slots from working hours (generates individual slots) */
  async bulkCreateSlots(
    providerId: string,
    role: string,
    dto: BulkCreateSlotsDto,
  ): Promise<any[]> {
    this.assertIsProvider(role);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const durationMin = dto.durationMinutes ?? 30;
    const providerObjectId = new Types.ObjectId(providerId);
    const generatedSlots = this.generateSlots(
      dto.startTime,
      dto.endTime,
      durationMin,
    );

    if (generatedSlots.length === 0 || dto.dates.length === 0) {
      return [];
    }

    const existingDocs = await this.slotModel
      .find({
        providerId: providerObjectId,
        date: { $in: dto.dates },
        startTime: { $in: generatedSlots.map((slot) => slot.startTime) },
      })
      .select('date startTime')
      .lean()
      .exec();

    const existingKeys = new Set(
      existingDocs.map((doc) => `${doc.date}|${doc.startTime}`),
    );

    const docsToInsert = dto.dates.flatMap((date) =>
      generatedSlots
        .filter((slot) => !existingKeys.has(`${date}|${slot.startTime}`))
        .map((slot) => ({
          providerId: providerObjectId,
          consultationType: dto.consultationType,
          date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          durationMinutes: durationMin,
          languages: dto.languages ?? [],
          mode: dto.mode ?? 'both',
          status: 'available' as const,
        })),
    );

    if (docsToInsert.length === 0) {
      return [];
    }

    const insertedDocs = await this.slotModel.insertMany(docsToInsert, {
      ordered: false,
    });
    return insertedDocs.map((doc) => this.formatSlot(doc.toObject()));
  }

  /** Block a time range (creates blocked slots) */
  async blockTimeRange(
    providerId: string,
    role: string,
    dto: BlockSlotDto,
  ): Promise<any> {
    this.assertIsProvider(role);
    await this.slotModel.updateMany(
      {
        providerId: new Types.ObjectId(providerId),
        date: dto.date,
        startTime: { $gte: dto.startTime },
        endTime: { $lte: dto.endTime },
        status: 'available',
      },
      { $set: { status: 'blocked' } },
    );
    const blocked = await this.slotModel.create({
      providerId: new Types.ObjectId(providerId),
      consultationType: 'doctor' as ConsultationType,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      durationMinutes: 0,
      status: 'blocked',
    });
    return this.formatSlot(blocked.toObject());
  }

  /** List slots for a provider (their own slots) */
  async listByProvider(providerId: string, date?: string): Promise<any[]> {
    const filter: FilterQuery<ConsultationSlotDocument> = {
      providerId: new Types.ObjectId(providerId),
    };
    if (date) filter.date = date;
    const docs = await this.slotModel
      .find(filter)
      .sort({ date: 1, startTime: 1 })
      .lean();
    return docs.map((d: unknown) => this.formatSlot(d));
  }

  /** List available slots for a specific provider (for booking) */
  async listAvailableByProvider(
    providerId: string,
    date?: string,
  ): Promise<any[]> {
    const filter: FilterQuery<ConsultationSlotDocument> = {
      providerId: new Types.ObjectId(providerId),
      status: 'available',
    };
    if (date) {
      filter.date = date;
    } else {
      filter.date = { $gte: new Date().toISOString().split('T')[0] };
    }
    const docs = await this.slotModel
      .find(filter)
      .sort({ date: 1, startTime: 1 })
      .lean();
    return docs.map((d: unknown) => this.formatSlot(d));
  }

  /** List available providers and their earliest slots by type */
  async listAvailableProviders(
    consultationType: ConsultationType,
    date?: string,
    language?: string,
  ): Promise<any[]> {
    const filter: FilterQuery<ConsultationSlotDocument> = {
      consultationType,
      status: 'available',
      date: { $gte: date ?? new Date().toISOString().split('T')[0] },
    };
    if (language) {
      filter.languages = { $in: [language] };
    }

    const docs = await this.slotModel
      .find(filter)
      .populate(
        'providerId',
        'fullName profilePic specialty role organizationId',
      )
      .sort({ date: 1, startTime: 1 })
      .lean();

    const providerMap = new Map<string, any>();
    for (const doc of docs) {
      const provider = doc.providerId as unknown as {
        _id?: { toString(): string };
        fullName?: string;
        profilePic?: string;
        specialty?: string;
        role?: string;
      };
      if (!provider) continue;
      const pid = provider._id?.toString();
      if (!pid) continue;
      if (!providerMap.has(pid)) {
        providerMap.set(pid, {
          providerId: pid,
          providerName: provider.fullName,
          providerProfilePic: provider.profilePic ?? '',
          specialty: provider.specialty ?? doc.specialty ?? '',
          role: provider.role,
          consultationType,
          nextAvailableDate: doc.date,
          nextAvailableTime: doc.startTime,
          languages: doc.languages ?? [],
          mode: doc.mode ?? 'both',
          totalAvailableSlots: 1,
        });
      } else {
        providerMap.get(pid).totalAvailableSlots += 1;
      }
    }
    return Array.from(providerMap.values());
  }

  /** List all available slots for a provider on a date range (for calendar view) */
  async listSlotsForCalendar(
    providerId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    const docs = await this.slotModel
      .find({
        providerId: new Types.ObjectId(providerId),
        date: { $gte: startDate, $lte: endDate },
      })
      .sort({ date: 1, startTime: 1 })
      .lean();
    return docs.map((d: unknown) => this.formatSlot(d));
  }

  /** Delete a slot (only if not booked) */
  async deleteSlot(slotId: string, providerId: string): Promise<void> {
    const slot = await this.slotModel.findById(slotId);
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.providerId.toString() !== providerId) {
      throw new ForbiddenException('You can only delete your own slots');
    }
    if (slot.status === 'booked') {
      throw new BadRequestException('Cannot delete a booked slot');
    }
    await this.slotModel.deleteOne({ _id: slotId });
  }

  /** Atomically lock a slot for booking (used by AppointmentsService) */
  async lockSlot(slotId: string): Promise<ConsultationSlotDocument | null> {
    return this.slotModel.findOneAndUpdate(
      { _id: new Types.ObjectId(slotId), status: 'available' },
      { $set: { status: 'booked' } },
      { new: true },
    );
  }

  /** Release a slot back to available (used when appointment is cancelled) */
  async releaseSlot(slotId: string): Promise<void> {
    await this.slotModel.findByIdAndUpdate(slotId, {
      $set: { status: 'available' },
    });
  }

  /** Admin: list all slots with optional filters */
  async adminListSlots(filters: {
    consultationType?: ConsultationType;
    status?: string;
    date?: string;
    providerId?: string;
  }): Promise<any[]> {
    const filter: FilterQuery<ConsultationSlotDocument> = {};
    if (filters.consultationType)
      filter.consultationType = filters.consultationType;
    if (filters.status) filter.status = filters.status;
    if (filters.date) filter.date = filters.date;
    if (filters.providerId)
      filter.providerId = new Types.ObjectId(filters.providerId);

    const docs = await this.slotModel
      .find(filter)
      .populate('providerId', 'fullName profilePic role specialty')
      .sort({ date: -1, startTime: 1 })
      .lean();
    return docs.map((d: unknown) => this.formatSlot(d));
  }

  private generateSlots(
    startTime: string,
    endTime: string,
    durationMin: number,
  ) {
    const slots: { startTime: string; endTime: string }[] = [];
    let current = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);
    while (current + durationMin <= end) {
      slots.push({
        startTime: this.minutesToTime(current),
        endTime: this.minutesToTime(current + durationMin),
      });
      current += durationMin;
    }
    return slots;
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private validateTimeRange(startTime: string, endTime: string): void {
    if (this.timeToMinutes(startTime) >= this.timeToMinutes(endTime)) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }

  formatSlot(d: unknown): Record<string, unknown> | null {
    if (!d) return null;
    const doc = d as Record<string, unknown>;
    const provider = doc.providerId as Record<string, unknown> | undefined;
    return {
      id: (doc._id as { toString(): string })?.toString(),
      providerId:
        typeof provider === 'object'
          ? (provider._id as { toString(): string })?.toString()
          : (provider as unknown as { toString(): string })?.toString(),
      providerName:
        typeof provider === 'object' ? provider.fullName : undefined,
      providerProfilePic:
        typeof provider === 'object' ? provider.profilePic : undefined,
      consultationType: doc.consultationType,
      date: doc.date,
      startTime: doc.startTime,
      endTime: doc.endTime,
      durationMinutes: doc.durationMinutes,
      status: doc.status,
      note: doc.note,
      languages: doc.languages ?? [],
      mode: doc.mode ?? 'both',
      specialty: doc.specialty,
      organizationId: (
        doc.organizationId as { toString(): string }
      )?.toString(),
      createdAt: doc.createdAt,
    };
  }
}
