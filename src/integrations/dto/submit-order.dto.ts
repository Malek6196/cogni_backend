import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitOrderDto {
  @ApiProperty({ description: 'Product external ID from catalog' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  externalId: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Product name (for display)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @ApiProperty({
    description: 'Order form data (e.g. fullName, email, address, city, phone)',
    example: {
      fullName: 'Jean Dupont',
      email: 'jean@example.com',
      address: '12 rue Example',
      city: 'Paris',
      phone: '0612345678',
    },
  })
  @IsObject()
  formData: Record<string, string>;
}
