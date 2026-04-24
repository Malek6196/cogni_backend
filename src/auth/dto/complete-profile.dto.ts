import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CompleteProfileDto {
  @ApiProperty({
    description: 'Specific care provider type',
    example: 'psychologist',
    enum: [
      'speech_therapist',
      'occupational_therapist',
      'psychologist',
      'doctor',
      'ergotherapist',
      'caregiver',
      'organization_leader',
      'other',
    ],
  })
  @IsNotEmpty()
  @IsEnum([
    'speech_therapist',
    'occupational_therapist',
    'psychologist',
    'doctor',
    'ergotherapist',
    'caregiver',
    'organization_leader',
    'other',
  ])
  careProviderType!:
    | 'speech_therapist'
    | 'occupational_therapist'
    | 'psychologist'
    | 'doctor'
    | 'ergotherapist'
    | 'caregiver'
    | 'organization_leader'
    | 'other';

  @ApiProperty({
    description: 'Password for the account (minimum 6 characters)',
    example: 'securePassword123',
    minLength: 6,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;
}
