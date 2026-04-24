import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class SetupChildLockDto {
  @ApiProperty({
    description: 'Custom play lock password or pin',
    minLength: 4,
    maxLength: 64,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(64)
  password!: string;
}

export class VerifyChildLockDto {
  @ApiProperty({ description: 'Play lock password or pin' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class ConfirmChildLockResetDto {
  @ApiProperty({ description: '6-digit reset code sent by email' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    description: 'New play lock password or pin',
    minLength: 4,
    maxLength: 64,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(64)
  newPassword!: string;
}

export class ResetChildLockByParentAuthDto {
  @ApiProperty({ description: 'Current parent account password' })
  @IsString()
  @IsNotEmpty()
  parentAccountPassword!: string;

  @ApiProperty({
    description: 'New play lock password or pin',
    minLength: 4,
    maxLength: 64,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(64)
  newPassword!: string;
}
