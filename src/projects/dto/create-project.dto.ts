import { ProjectStatus, ProjectType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';

export class ExpectedCostBreakdownDto {
  @IsOptional()
  @IsMoney()
  materials?: string;

  @IsOptional()
  @IsMoney()
  labour?: string;

  @IsOptional()
  @IsMoney()
  transport?: string;

  @IsOptional()
  @IsMoney()
  equipment?: string;

  @IsOptional()
  @IsMoney()
  subcontractors?: string;

  @IsOptional()
  @IsMoney()
  other?: string;
}

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  projectManagerId?: string;

  @IsOptional()
  @IsString()
  siteAddress?: string;

  @IsOptional()
  @IsString()
  contractNo?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  projectType?: ProjectType;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsDateString()
  contractStartDate?: string;

  @IsOptional()
  @IsDateString()
  plannedCompletionDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsMoney()
  originalContractValue?: string;

  @IsOptional()
  @IsMoney()
  expectedTotalCost?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExpectedCostBreakdownDto)
  expectedCosts?: ExpectedCostBreakdownDto;

  @IsOptional()
  @IsBoolean()
  usesBoq?: boolean;
}
