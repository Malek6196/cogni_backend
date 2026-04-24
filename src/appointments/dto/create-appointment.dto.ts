import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsMongoId,
  MaxLength,
  MinLength,
  Min,
  Max,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAppointmentDto {
  @ApiProperty({ description: 'ID of the ConsultationSlot to book' })
  @IsMongoId()
  slotId!: string;

  @ApiProperty({
    description: 'Reason for the consultation',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Please provide a detailed reason (min 10 chars)' })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ example: 'fr', default: 'fr' })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @ApiPropertyOptional({ description: 'Additional notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Child ID if booking for a child' })
  @IsOptional()
  @IsMongoId()
  childId?: string;

  @ApiPropertyOptional({ description: 'Child name for display' })
  @IsOptional()
  @IsString()
  childName?: string;

  @ApiPropertyOptional({
    enum: ['video', 'in_person', 'both'],
    default: 'both',
  })
  @IsOptional()
  @IsEnum(['video', 'in_person', 'both'])
  mode?: 'video' | 'in_person' | 'both';
}

export class CancelAppointmentDto {
  @ApiPropertyOptional({ description: 'Reason for cancellation' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CompleteAppointmentDto {
  @ApiPropertyOptional({ description: 'Provider notes after consultation' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  providerNotes?: string;
}

export class RateAppointmentDto {
  @ApiProperty({ description: 'Rating 1-5', minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ description: 'Written feedback' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}
