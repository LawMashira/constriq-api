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
    return protocol === 'https:' && hostname === 'constriq.vercel.app';
  } catch {
    return false;
  }
}

export function corsPreflightMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedCorsOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    );
    res.header('Access-Control-Max-Age', '86400');
    res.header('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
