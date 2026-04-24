import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GameType } from './game-session.schema';

export type GameProgressDocument = GameProgress & Document;

@Schema({ timestamps: true })
export class GameProgress {
  @Prop({ type: Types.ObjectId, ref: 'Child', required: true })
  childId!: Types.ObjectId;

  @Prop({ enum: GameType, required: true })
  gameType!: GameType;

  @Prop({ type: Object, default: {} })
  state!: Record<string, unknown>;

  @Prop({ default: 0, min: 0, max: 100 })
  progressPercent!: number;

  @Prop({ default: false })
  completed!: boolean;

  @Prop()
  lastPlayedAt?: Date;
}

export const GameProgressSchema = SchemaFactory.createForClass(GameProgress);
GameProgressSchema.index({ childId: 1, gameType: 1 }, { unique: true });
