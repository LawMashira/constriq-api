import { IsString, Length, Matches, MinLength } from 'class-validator';

export class ConfirmMfaDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}

export class DisableMfaDto {
  @IsString()
  @MinLength(8)
  password: string;
}
