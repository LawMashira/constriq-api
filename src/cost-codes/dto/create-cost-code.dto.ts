import { CostCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCostCodeDto {
  @IsString()
  @MaxLength(20)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(CostCategory)
  category?: CostCategory;

  @IsOptional()
  @IsString()
  description?: string;
}
