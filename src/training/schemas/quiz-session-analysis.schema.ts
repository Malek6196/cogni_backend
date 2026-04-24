import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QuizSessionAnalysisDocument = QuizSessionAnalysis & Document;
export type QuizRiskLevel = 'low' | 'medium' | 'high';

// Nested schema for behavior summary metrics.
class BehaviorSummary {
  avgTimeMs: number;
  answerChanges: number;
  interruptions: number;
  tooFastCount: number;
  slowCount: number;
}

// Nested schema for camera attention data (optional).
class AttentionData {
  overallScore: number;
  facePresenceRatio: number;
  lookingAwayCount: number;
  totalSamples: number;
}

@Schema({ timestamps: true })
export class QuizSessionAnalysis {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'TrainingCourse',
    required: true,
    index: true,
  })
  quizId: Types.ObjectId;

  @Prop({ required: true, min: 0, max: 100 })
  engagementScore: number;

  @Prop({ required: true, min: 0, max: 100 })
  reliabilityScore: number;

  @Prop({ type: [String], default: [] })
  flags: string[];

  @Prop({ type: Object })
  behaviorSummary: BehaviorSummary;

  /// Camera attention data — present only when user consented to camera.
  @Prop({ type: Object, required: false })
  attentionData?: AttentionData;

  /// ML model version used for scoring. Allows tracing which engine produced
  /// a given result — swap 'rule-based-v1' for 'ml-model-v1' when upgrading.
  @Prop({ default: 'rule-based-v1' })
  modelVersion: string;

  @Prop({ enum: ['low', 'medium', 'high'], default: 'low' })
  riskLevel: QuizRiskLevel;

  createdAt?: Date;
  updatedAt?: Date;
}

export const QuizSessionAnalysisSchema =
  SchemaFactory.createForClass(QuizSessionAnalysis);

// Compound index: one analysis per user per quiz attempt (latest wins).
QuizSessionAnalysisSchema.index({ userId: 1, quizId: 1 });
