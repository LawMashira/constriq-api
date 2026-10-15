import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { IsMoney, IsQuantity } from '../common/dto/money-field';

export class CreateProcurementRequestDto {
  @IsString()
  description: string;

  @IsQuantity()
  quantity: string;

  @IsQuantity()
  rate: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsDateString()
  requiredDate?: string;
}

export class CreateSupplierDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  registrationNo?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;
}

export class PoLineDto {
  @IsString()
  costCodeId: string;

  @IsString()
  description: string;

  @IsQuantity()
  quantity: string;

  @IsQuantity()
  unitRate: string;
}

export class CreatePurchaseOrderDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  poNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines: PoLineDto[];
}

export class ConvertProcurementRequestDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  poNumber?: string;
}

export class CreateInvoiceDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsString()
  invoiceNumber: string;

  @IsDateString()
  invoiceDate: string;

  @IsMoney()
  subtotal: string;

  @IsMoney()
  taxAmount: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}

export class LinkInvoiceDto {
  @IsString()
  purchaseOrderId: string;
}

export class InvoiceLineDto {
  @IsOptional()
  @IsString()
  purchaseOrderLineId?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsString()
  description: string;

  @IsQuantity()
  quantity: string;

  @IsQuantity()
  unitRate: string;
}
