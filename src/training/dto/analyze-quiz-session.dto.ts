import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum BehaviorFlagDto {
  FAST_ANSWERS = 'FAST_ANSWERS',
  FREQUENT_APP_SWITCHING = 'FREQUENT_APP_SWITCHING',
  HIGH_HESITATION = 'HIGH_HESITATION',
  RANDOM_PATTERNS = 'RANDOM_PATTERNS',
  REPEATED_WRONG_PATTERNS = 'REPEATED_WRONG_PATTERNS',
  LOW_ENGAGEMENT = 'LOW_ENGAGEMENT',
  INCONSISTENT_PACING = 'INCONSISTENT_PACING',
  FATIGUE_SIGNALS = 'FATIGUE_SIGNALS',
}

export class BehaviorSummaryDto {
  @ApiProperty() @IsNumber() avgTimeMs: number;
  @ApiProperty() @IsNumber() answerChanges: number;
  @ApiProperty() @IsNumber() interruptions: number;
  @ApiProperty() @IsNumber() tooFastCount: number;
  @ApiProperty() @IsNumber() slowCount: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() totalInactivityMs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalDurationMs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() avgHesitationMs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tapBurstScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() hesitationSpikes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() distractionMoments?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() paceVariability?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longestWrongStreak?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lateSessionSlowdownRatio?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lateSessionAccuracyDrop?: number;
}

export class AttentionDataDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(100) overallScore: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(1) facePresenceRatio: number;
  @ApiProperty() @IsNumber() lookingAwayCount: number;
  @ApiProperty() @IsNumber() totalSamples: number;
}

export class AnalyzeQuizSessionDto {
  @ApiProperty({ description: 'Course/quiz ID' })
  @IsMongoId()
  quizId: string;

  @ApiProperty({
    description: 'Engagement score 0–100',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  engagementScore?: number;

  @ApiProperty({
    description: 'Reliability score 0–100',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  reliabilityScore?: number;

  @ApiProperty({ type: [String], description: 'Detected behavior flags' })
  @IsOptional()
  @IsArray()
  @IsEnum(BehaviorFlagDto, { each: true })
  flags?: BehaviorFlagDto[];

  @ApiProperty({ type: BehaviorSummaryDto })
  @ValidateNested()
  @Type(() => BehaviorSummaryDto)
  behaviorSummary: BehaviorSummaryDto;

  @ApiPropertyOptional({ type: AttentionDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttentionDataDto)
  attentionData?: AttentionDataDto;
}
