import type { NextFunction, Request, Response } from 'express';

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

export function isAllowedCorsOrigin(origin?: string) {
  if (!origin) {
    return false;
  }
  const normalized = origin.replace(/\/$/, '');
  if (corsOriginList().includes(normalized)) {
    return true;
  }
  try {
    const { protocol, hostname } = new URL(normalized);
    if (protocol !== 'https:') {
      return false;
    }
    return hostname === 'constriq.vercel.app' || /^constriq[-.].+\.vercel\.app$/.test(hostname);
  } catch {
    return false;
  }
}

function applyCorsHeaders(req: Request, res: Response, origin: string) {
  const requested = req.headers['access-control-request-headers'];
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    typeof requested === 'string' && requested.trim()
      ? requested
      : 'Content-Type, Authorization, Accept, Origin, X-Requested-With, sentry-trace, baggage',
  );
  res.header('Access-Control-Max-Age', '86400');
  res.header('Vary', 'Origin, Access-Control-Request-Headers');
}

export function corsPreflightMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedCorsOrigin(origin)) {
    applyCorsHeaders(req, res, origin);
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
