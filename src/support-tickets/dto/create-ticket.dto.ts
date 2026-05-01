import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ enum: ['bug', 'suggestion', 'contact'] })
  @IsEnum(['bug', 'suggestion', 'contact'])
  type!: 'bug' | 'suggestion' | 'contact';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'urgent'] })
  @IsOptional()
  @IsEnum(['low', 'medium', 'urgent'])
  priority?: 'low' | 'medium' | 'urgent';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
