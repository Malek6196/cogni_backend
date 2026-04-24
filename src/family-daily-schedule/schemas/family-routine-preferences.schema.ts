import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FamilyRoutinePreferencesDocument = FamilyRoutinePreferences &
  Document;

@Schema({ timestamps: true })
export class FamilyRoutinePreferences {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Si défini, préférences spécifiques à cet enfant ; sinon profil par défaut famille. */
  @Prop({ type: Types.ObjectId, ref: 'Child' })
  childId?: Types.ObjectId;

  @Prop({ default: '07:00' })
  wakeTime?: string;

  @Prop({ default: '21:00' })
  sleepTime?: string;

  @Prop({ default: '12:30' })
  lunchTime?: string;

  @Prop()
  notes?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FamilyRoutinePreferencesSchema = SchemaFactory.createForClass(
  FamilyRoutinePreferences,
);
FamilyRoutinePreferencesSchema.index({ userId: 1, childId: 1 });
