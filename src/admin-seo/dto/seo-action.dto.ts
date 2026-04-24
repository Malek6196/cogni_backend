import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  SeoActionType,
  SeoJobStatus,
  SeoToolName,
} from '../admin-seo.constants';

export class SeoActionRequestDto {
  @IsEnum(SeoActionType)
  action: SeoActionType;

  @IsOptional()
  @IsString()
  targetPath?: string;

  @IsOptional()
  @IsEnum(SeoToolName)
  tool?: SeoToolName;

  @IsString()
  idempotencyKey: string;
}

export class SeoActionResultDto {
  @IsString()
  jobId: string;

  @IsEnum(SeoJobStatus)
  status: SeoJobStatus;

  @IsDateString()
  startedAt: string;

  @IsOptional()
  @IsDateString()
  finishedAt?: string;

  @IsString()
  summary: string;

  @IsOptional()
  @IsString()
  errorCode?: string;
}

export class SeoActionHistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SeoActionHistoryItemDto {
  @IsString()
  id: string;

  @IsEnum(SeoActionType)
  action: SeoActionType;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsEnum(SeoToolName)
  tool?: SeoToolName;

  @IsEnum(SeoJobStatus)
  status: SeoJobStatus;

  @IsString()
  correlationId: string;

  @IsDateString()
  startedAt: string;

  @IsOptional()
  @IsDateString()
  finishedAt?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  errorCode?: string;
}

export class SeoActionHistoryResponseDto {
  items: SeoActionHistoryItemDto[];

  @IsOptional()
  @IsString()
  nextCursor?: string;
}

export class SeoToolStatusResponseDto {
  toolStatuses: Array<{
    tool: SeoToolName;
    status: string;
    lastSuccessfulRunAt?: string;
    lastErrorSummary?: string;
  }>;
}
