import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExtraAppointmentDto {
  @ApiProperty({ example: '10:00' })
  @IsString()
  @IsNotEmpty()
  time!: string;

  @ApiProperty({ example: 'Orthophonie' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subtitle?: string;
}

export class GenerateDailyScheduleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  childId!: string;

  @ApiProperty({
    description: 'Date cible YYYY-MM-DD (ex. demain, fuseau local app)',
  })
  @IsString()
  @IsNotEmpty()
  date!: string;

  @ApiPropertyOptional({
    description: 'Rendez-vous hors API (calendrier local app)',
    type: [ExtraAppointmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraAppointmentDto)
  appointments?: ExtraAppointmentDto[];

  @ApiPropertyOptional({
    description: 'Notes libres pour affiner le plan (ex. école, visite)',
  })
  @IsOptional()
  @IsString()
  userNotes?: string;

  @ApiPropertyOptional({
    description:
      'Réponse à une question de suivi (ex. choix utilisateur) pour régénérer le plan',
  })
  @IsOptional()
  @IsString()
  followUpContext?: string;

  @ApiPropertyOptional({
    description:
      'Transcript du chat (tours précédents) pour garder le fil de la conversation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conversationHistory?: string;

  @ApiPropertyOptional({
    description: 'Créer une notification in-app avec le résumé',
  })
  @IsOptional()
  @IsBoolean()
  createNotification?: boolean;
}
