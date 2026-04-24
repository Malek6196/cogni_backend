import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReelDocument = Reel & Document;

@Schema({ timestamps: true })
export class Reel {
  @Prop({ required: true })
  sourceId!: string;

  @Prop({
    required: true,
    enum: ['youtube', 'scraped', 'dailymotion', 'tiktok'],
  })
  source!: 'youtube' | 'scraped' | 'dailymotion' | 'tiktok';

  @Prop({ required: true })
  title!: string;

  @Prop({ default: '' })
  description!: string;

  @Prop({ required: true })
  videoUrl!: string;

  @Prop({ required: true })
  thumbnailUrl!: string;

  @Prop({ default: Date.now })
  publishedAt!: Date;

  /** Score de pertinence (0–1) pour troubles cognitifs / autisme, si filtre IA utilisé. */
  @Prop({ min: 0, max: 1 })
  relevanceScore?: number;

  @Prop({ default: 'fr' })
  language?: string;

  /** TikTok / oEmbed — nom du créateur affiché dans l’UI type capture. */
  @Prop()
  authorName?: string;
  /** Engagement counters - start at 0, increment on user interaction */
  @Prop({ default: 0, min: 0 })
  likesCount!: number;

  @Prop({ default: 0, min: 0 })
  commentsCount!: number;

  @Prop({ default: 0, min: 0 })
  savesCount!: number;

  @Prop({ default: 0, min: 0 })
  sharesCount!: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ReelSchema = SchemaFactory.createForClass(Reel);
ReelSchema.index({ source: 1, sourceId: 1 }, { unique: true });
ReelSchema.index({ publishedAt: -1 });
