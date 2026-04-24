import { ApiProperty } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGameRequestDto {
  @ApiProperty({ description: 'Child ID for whom the game is requested' })
  @IsMongoId()
  @IsNotEmpty()
  childId!: string;

  @ApiProperty({
    description: 'Requested game name',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  gameName!: string;

  @ApiProperty({
    description: 'What the game should do',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description!: string;

  @ApiProperty({
    description: 'Specific child needs this game should address',
    minLength: 5,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  childNeeds!: string;
}
