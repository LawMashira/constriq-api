const DEFAULT_ORIGINS = [
  'https://constriq.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
];

export function corsOriginList() {
  const extra = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}
