import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { IsMoney, IsQuantity } from '../../common/dto/money-field';

export class BoqItemDto {
  @IsString()
  itemCode: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  section?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsQuantity()
  quantity: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsQuantity()
  rate: string;
}

export class CreateBoqDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqItemDto)
  items: BoqItemDto[];
}
