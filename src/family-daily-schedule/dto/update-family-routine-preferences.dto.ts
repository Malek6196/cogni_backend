import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFamilyRoutinePreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  childId?: string;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  wakeTime?: string;

  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @IsString()
  sleepTime?: string;

  @ApiPropertyOptional({ example: '12:30' })
  @IsOptional()
  @IsString()
  lunchTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
