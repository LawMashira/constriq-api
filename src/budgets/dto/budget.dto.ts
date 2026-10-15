import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';

export class BudgetLineDto {
  @IsString()
  costCodeId: string;

  @IsMoney()
  amount: string;
}

export class CreateBudgetDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

export class CreateBudgetRevisionDto {
  @IsString()
  reason: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}
