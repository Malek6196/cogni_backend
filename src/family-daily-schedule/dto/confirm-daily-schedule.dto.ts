import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Enregistre l’acceptation du plan et met à jour les préférences (personnalisation). */
export class ConfirmDailyScheduleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  childId!: string;

  @ApiProperty({ description: 'Date du plan YYYY-MM-DD' })
  @IsString()
  @IsNotEmpty()
  date!: string;

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
}
