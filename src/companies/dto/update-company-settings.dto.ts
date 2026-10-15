import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { VariationRevenueRule } from '@prisma/client';
import { IsMoney } from '../../common/dto/money-field';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPaymentTermsDays?: number;

  @IsOptional()
  @IsMoney()
  defaultRetentionPercent?: string;

  @IsOptional()
  @IsEnum(VariationRevenueRule)
  variationRevenueRule?: VariationRevenueRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  forecastStaleDays?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  taxInclusiveDefault?: boolean;
}
