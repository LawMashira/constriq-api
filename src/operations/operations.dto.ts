import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { EquipmentOwnership } from '@prisma/client';
import { IsMoney, IsQuantity } from '../common/dto/money-field';

export class CreatePartyDto {
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
}

export class CreateWorkerDto extends CreatePartyDto {
  @IsOptional()
  @IsString()
  employeeNo?: string;

  @IsOptional()
  @IsString()
  trade?: string;

  @IsOptional()
  @IsQuantity()
  hourlyRate?: string;
}

export class CreateLabourDto {
  @IsString()
  workerId: string;

  @IsString()
  costCodeId: string;

  @IsDateString()
  workDate: string;

  @IsQuantity()
  hours: string;

  @IsOptional()
  @IsQuantity()
  overtimeHours?: string;

  @IsQuantity()
  rate: string;
}

export class CreateEquipmentDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(EquipmentOwnership)
  ownership?: EquipmentOwnership;

  @IsOptional()
  @IsString()
  hireSupplierId?: string;

  @IsOptional()
  @IsQuantity()
  hireRate?: string;
}

export class CreatePlantDto {
  @IsString()
  description: string;

  @IsDateString()
  workDate: string;

  @IsMoney()
  amount: string;

  @IsOptional()
  @IsString()
  equipmentId?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsQuantity()
  operatingHours?: string;

  @IsOptional()
  @IsQuantity()
  hireRate?: string;

  @IsOptional()
  @IsMoney()
  fuelCost?: string;

  @IsOptional()
  @IsMoney()
  maintenanceCost?: string;

  @IsOptional()
  @IsMoney()
  transportCost?: string;
}

export class CreateSubcontractDto {
  @IsString()
  subcontractorId: string;

  @IsString()
  description: string;

  @IsMoney()
  originalValue: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  contractNo?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsQuantity()
  retentionPercent?: string;
}

export class CreateSubcontractClaimDto {
  @IsString()
  subcontractId: string;

  @IsMoney()
  amount: string;

  @IsDateString()
  claimDate: string;

  @IsOptional()
  @IsString()
  claimNo?: string;
}

export class CertifySubcontractClaimDto {
  @IsMoney()
  certifiedAmount: string;
}

export class AllocateEquipmentDto {
  @IsString()
  equipmentId: string;

  @IsDateString()
  startDate: string;
}
