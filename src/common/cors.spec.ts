import { isAllowedCorsOrigin } from './cors';

describe('CORS origins', () => {
  it('allows the production Vercel app', () => {
    expect(isAllowedCorsOrigin('https://constriq.vercel.app')).toBe(true);
  });

  it('allows Vercel preview hosts for this project', () => {
    expect(isAllowedCorsOrigin('https://constriq-git-main-team.vercel.app')).toBe(true);
  });

  it('rejects unrelated sites', () => {
    expect(isAllowedCorsOrigin('https://evil.example')).toBe(false);
  });
});
