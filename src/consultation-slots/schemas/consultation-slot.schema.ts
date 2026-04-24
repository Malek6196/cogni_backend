import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConsultationSlotDocument = ConsultationSlot & Document;

export type SlotStatus = 'available' | 'booked' | 'blocked';
export type ConsultationType = 'doctor' | 'volunteer' | 'organization_staff';

@Schema({ timestamps: true })
export class ConsultationSlot {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  providerId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['doctor', 'volunteer', 'organization_staff'],
    index: true,
  })
  consultationType!: ConsultationType;

  /** ISO date string YYYY-MM-DD */
  @Prop({ required: true, index: true })
  date!: string;

  /** HH:MM */
  @Prop({ required: true })
  startTime!: string;

  /** HH:MM */
  @Prop({ required: true })
  endTime!: string;

  /** Slot duration in minutes */
  @Prop({ required: true, default: 30 })
  durationMinutes!: number;

  @Prop({
    required: true,
    enum: ['available', 'booked', 'blocked'],
    default: 'available',
    index: true,
  })
  status!: SlotStatus;

  /** Optional note from provider (e.g. "Video only") */
  @Prop()
  note?: string;

  /** Languages provider can consult in */
  @Prop({ type: [String], default: [] })
  languages?: string[];

  /** Whether this slot is for video/in-person/both */
  @Prop({
    enum: ['video', 'in_person', 'both'],
    default: 'both',
  })
  mode?: 'video' | 'in_person' | 'both';

  /** Organization ID if provider belongs to an org */
  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  organizationId?: Types.ObjectId;

  /** Specialty label (for doctors) */
  @Prop()
  specialty?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ConsultationSlotSchema =
  SchemaFactory.createForClass(ConsultationSlot);

ConsultationSlotSchema.index({ providerId: 1, date: 1, status: 1 });
ConsultationSlotSchema.index({ consultationType: 1, date: 1, status: 1 });
