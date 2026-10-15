import { ForbiddenException } from '@nestjs/common';
import { assertSameCompany } from './tenant';

describe('assertSameCompany', () => {
  it('allows matching tenant ids', () => {
    expect(() => assertSameCompany('co_a', 'co_a')).not.toThrow();
  });

  it('rejects cross-tenant access', () => {
    expect(() => assertSameCompany('co_a', 'co_b')).toThrow(ForbiddenException);
  });
});
