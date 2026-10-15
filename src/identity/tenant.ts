import { ForbiddenException } from '@nestjs/common';

export function assertSameCompany(actorCompanyId: string, recordCompanyId: string) {
  if (actorCompanyId !== recordCompanyId) {
    throw new ForbiddenException('Resource does not belong to this company');
  }
}
