import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  SeoActionType,
  SeoJobStatus,
  SeoToolName,
} from '../admin-seo.constants';

export type SeoActionAuditDocument = SeoActionAudit & Document;

@Schema({ collection: 'seo_action_audit', timestamps: true })
export class SeoActionAudit {
  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true })
  role: string;

  @Prop({ type: String, required: true, enum: Object.values(SeoActionType) })
  action: SeoActionType;

  @Prop({ type: String, default: null })
  target?: string | null;

  @Prop({ type: String, enum: Object.values(SeoToolName), default: null })
  tool?: SeoToolName | null;

  @Prop({ type: String, required: true, enum: Object.values(SeoJobStatus) })
  status: SeoJobStatus;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true, unique: true })
  correlationId: string;

  @Prop({ required: true })
  jobId: string;

  @Prop({ type: String, default: null })
  summary?: string | null;

  @Prop({ type: String, default: null })
  errorCode?: string | null;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  finishedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SeoActionAuditSchema =
  SchemaFactory.createForClass(SeoActionAudit);
SeoActionAuditSchema.index({ actorId: 1, idempotencyKey: 1 }, { unique: true });
SeoActionAuditSchema.index({ createdAt: -1 });
