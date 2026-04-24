import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class SaveGameProgressDto {
  @ApiProperty({
    required: false,
    description: 'Serializable game state for resume support',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description: 'Progress percentage from 0 to 100',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @ApiProperty({
    required: false,
    description: 'Whether this game instance is completed',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
