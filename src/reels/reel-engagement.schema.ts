import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReelEngagementDocument = ReelEngagement & Document;

@Schema({ timestamps: true })
export class ReelEngagement {
  /** Reference to the Reel */
  @Prop({ type: Types.ObjectId, ref: 'Reel', required: true, index: true })
  reelId!: Types.ObjectId;

  /** Reference to the User who engaged */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** Type of engagement */
  @Prop({ enum: ['like', 'save', 'share', 'comment'], required: true })
  type!: 'like' | 'save' | 'share' | 'comment';

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReelEngagementSchema =
  SchemaFactory.createForClass(ReelEngagement);

// Prevent duplicates only for idempotent actions (like/save), not share/comment.
ReelEngagementSchema.index(
  { reelId: 1, userId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: { $in: ['like', 'save'] } },
  },
);
// Index for querying user's engagements
ReelEngagementSchema.index({ userId: 1, type: 1 });
// Index for querying reel's engagements
ReelEngagementSchema.index({ reelId: 1, type: 1 });
