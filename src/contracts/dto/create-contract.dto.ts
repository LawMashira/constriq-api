import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';

export class CreateContractDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  contractNo: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title: string;

  @IsMoney()
  originalValue: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
