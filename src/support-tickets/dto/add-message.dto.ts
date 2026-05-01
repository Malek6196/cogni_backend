import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
