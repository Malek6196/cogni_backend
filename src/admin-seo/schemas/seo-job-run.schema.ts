import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  SeoActionType,
  SeoJobStatus,
  SeoToolName,
} from '../admin-seo.constants';

export type SeoJobRunDocument = SeoJobRun & Document;

@Schema({ collection: 'seo_job_runs', timestamps: true })
export class SeoJobRun {
  @Prop({ type: String, required: true, enum: Object.values(SeoActionType) })
  action: SeoActionType;

  @Prop({ type: String, enum: Object.values(SeoToolName), default: null })
  tool?: SeoToolName | null;

  @Prop({ type: String, default: null })
  target?: string | null;

  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true })
  role: string;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true, unique: true })
  correlationId: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(SeoJobStatus),
    default: SeoJobStatus.PENDING,
  })
  status: SeoJobStatus;

  @Prop({ default: 'Queued for asynchronous execution.' })
  summary: string;

  @Prop({ type: String, default: null })
  errorCode?: string | null;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SeoJobRunSchema = SchemaFactory.createForClass(SeoJobRun);
SeoJobRunSchema.index({ status: 1, createdAt: 1 });
SeoJobRunSchema.index({ actorId: 1, idempotencyKey: 1 });
