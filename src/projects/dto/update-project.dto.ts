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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../common/dto/money-field';
import { ExpectedCostBreakdownDto } from './create-project.dto';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  clientId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  projectManagerId?: string | null;

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
