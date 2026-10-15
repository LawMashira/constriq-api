import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';

export class CreateActualCostDto {
  @IsString()
  description: string;

  @IsMoney()
  amount: string;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
