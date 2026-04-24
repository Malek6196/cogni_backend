import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GameRequestDocument = GameRequest & Document;

export enum GameRequestStatus {
  PENDING = 'pending',
  REVIEWING = 'reviewing',
  PLANNED = 'planned',
  REJECTED = 'rejected',
  RELEASED = 'released',
}

@Schema({ timestamps: true })
export class GameRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  familyUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Child', required: true })
  childId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  gameName!: string;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ required: true, trim: true })
  childNeeds!: string;

  @Prop({ enum: GameRequestStatus, default: GameRequestStatus.PENDING })
  status!: GameRequestStatus;
}

export const GameRequestSchema = SchemaFactory.createForClass(GameRequest);
GameRequestSchema.index({ status: 1, createdAt: -1 });
GameRequestSchema.index({ familyUserId: 1, createdAt: -1 });
GameRequestSchema.index({ childId: 1, createdAt: -1 });
