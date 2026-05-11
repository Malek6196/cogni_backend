import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum SocialProvider {
  GOOGLE = 'google',
}

export class SocialLoginDto {
  @ApiProperty({
    description: 'Social identity provider',
    enum: SocialProvider,
    example: SocialProvider.GOOGLE,
  })
  @IsEnum(SocialProvider)
  provider!: SocialProvider;

  @ApiProperty({
    description:
      'OIDC ID token obtained from the provider SDK on the device. The backend verifies this token signature and claims.',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  idToken!: string;

  @ApiPropertyOptional({
    description:
      'Optional user display name from provider SDK. Backend does not trust identity fields in token payload from client and uses verified claims first.',
    example: 'Malek Benslimen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({
    description:
      'Role to assign only when creating a new social account. Existing accounts keep their stored role.',
    example: 'careProvider',
    enum: ['family', 'careProvider'],
  })
  @IsOptional()
  @IsIn(['family', 'careProvider'])
  role?: 'family' | 'careProvider';
}
