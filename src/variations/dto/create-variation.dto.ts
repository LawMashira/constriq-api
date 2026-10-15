import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';

export class CreateVariationDto {
  @IsString()
  variationNo: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  clientInstruction?: string;

  @IsOptional()
  @IsDateString()
  instructionDate?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  boqItemId?: string;

  @IsMoney()
  contractorCost: string;

  @IsMoney()
  sellingPrice: string;
}
