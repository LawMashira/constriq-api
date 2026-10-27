import { duplicateLumpRemainingPostingIds } from './remaining-forecast';

describe('duplicateLumpRemainingPostingIds', () => {
  it('ignores GEN/OTH remaining when a BOQ remaining already exists', () => {
    const ignored = duplicateLumpRemainingPostingIds([
      { financialPostingId: 'boq', costCode: { code: 'BOQ' } },
      { financialPostingId: 'oth', costCode: { code: 'OTH' } },
    ]);
    expect([...ignored]).toEqual(['oth']);
  });

  it('keeps a lone original estimate', () => {
    const ignored = duplicateLumpRemainingPostingIds([
      { financialPostingId: 'oth', costCode: { code: 'OTH' } },
    ]);
    expect(ignored.size).toBe(0);
  });
});
