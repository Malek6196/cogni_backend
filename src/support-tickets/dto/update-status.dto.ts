import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateStatusDto {
  @ApiProperty({ enum: ['open', 'in_progress', 'resolved'] })
  @IsEnum(['open', 'in_progress', 'resolved'])
  status!: 'open' | 'in_progress' | 'resolved';
}
