import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AppointmentDocument = Appointment & Document;

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'rescheduled'
  | 'no_show';

@Schema({ timestamps: true })
export class Appointment {
  /** The family/parent who booked */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** The doctor/volunteer/org_staff */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  providerId!: Types.ObjectId;

  /** The booked consultation slot */
  @Prop({ type: Types.ObjectId, ref: 'ConsultationSlot', required: true })
  slotId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['doctor', 'volunteer', 'organization_staff'],
    index: true,
  })
  consultationType!: string;

  @Prop({
    required: true,
    enum: [
      'pending',
      'confirmed',
      'cancelled',
      'completed',
      'rescheduled',
      'no_show',
    ],
    default: 'confirmed',
    index: true,
  })
  status!: AppointmentStatus;

  /** ISO date string YYYY-MM-DD */
  @Prop({ required: true, index: true })
  date!: string;

  @Prop({ required: true })
  startTime!: string;

  @Prop({ required: true })
  endTime!: string;

  /** Reason for the consultation */
  @Prop({ required: true })
  reason!: string;

  /** Preferred consultation language */
  @Prop({ default: 'fr' })
  preferredLanguage!: string;

  /** Optional notes from user */
  @Prop()
  notes?: string;

  /** Optional child ID if booking is for a child */
  @Prop({ type: Types.ObjectId, ref: 'Child' })
  childId?: Types.ObjectId;

  /** Child name cached for display */
  @Prop()
  childName?: string;

  /** Preferred mode: video / in_person */
  @Prop({ enum: ['video', 'in_person', 'both'], default: 'both' })
  mode!: 'video' | 'in_person' | 'both';

  /** Unique human-readable booking reference (e.g. BK-2026-00042) */
  @Prop({ unique: true, sparse: true })
  bookingRef?: string;

  /** Cancellation reason if cancelled */
  @Prop()
  cancellationReason?: string;

  /** Who cancelled: 'user' | 'provider' | 'admin' */
  @Prop({ enum: ['user', 'provider', 'admin'] })
  cancelledBy?: 'user' | 'provider' | 'admin';

  /** Timestamp when cancelled */
  @Prop()
  cancelledAt?: Date;

  /** Provider notes after the consultation */
  @Prop()
  providerNotes?: string;

  /** User feedback/rating after consultation */
  @Prop({ type: Number, min: 1, max: 5 })
  userRating?: number;

  @Prop()
  userFeedback?: string;

  /** Whether 24h reminder was sent */
  @Prop({ default: false })
  reminder24hSent!: boolean;

  /** Whether 2h reminder was sent */
  @Prop({ default: false })
  reminder2hSent!: boolean;

  /** Whether confirmation notification was sent */
  @Prop({ default: false })
  confirmationSent!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

AppointmentSchema.index({ userId: 1, status: 1 });
AppointmentSchema.index({ providerId: 1, status: 1 });
AppointmentSchema.index({ date: 1, status: 1 });
