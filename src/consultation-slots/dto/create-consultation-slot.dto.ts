import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ConsultationType } from '../schemas/consultation-slot.schema';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

export class CreateConsultationSlotDto {
  @ApiProperty({
    example: 'doctor',
    enum: ['doctor', 'volunteer', 'organization_staff'],
  })
  @IsEnum(['doctor', 'volunteer', 'organization_staff'])
  consultationType!: ConsultationType;

  @ApiProperty({ example: '2026-04-15' })
  @IsString()
  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '09:30' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 'Video consultation only' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ type: [String], example: ['fr', 'ar'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: ['video', 'in_person', 'both'] })
  @IsOptional()
  @IsEnum(['video', 'in_person', 'both'])
  mode?: 'video' | 'in_person' | 'both';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;
}

export class BulkCreateSlotsDto {
  @ApiProperty({
    example: 'doctor',
    enum: ['doctor', 'volunteer', 'organization_staff'],
  })
  @IsEnum(['doctor', 'volunteer', 'organization_staff'])
  consultationType!: ConsultationType;

  @ApiProperty({ type: [String], example: ['2026-04-15', '2026-04-16'] })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  dates!: string[];

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: ['video', 'in_person', 'both'] })
  @IsOptional()
  @IsEnum(['video', 'in_person', 'both'])
  mode?: 'video' | 'in_person' | 'both';
}

export class BlockSlotDto {
  @ApiProperty({ example: '2026-04-15' })
  @IsString()
  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_REGEX)
  startTime!: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  @Matches(TIME_REGEX)
  endTime!: string;
}
