# CONSTRIQ API

Construction profit intelligence and project financial control.

- **Manual (setup, product flow, deploy, ops):** [MANUAL.md](./MANUAL.md)
- **Frontend API contract:** [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)
- **Swagger:** `/docs` when the server is running

```bash
npm ci
cp .env.example .env   # fill DATABASE_URL, DIRECT_URL, JWT, Brevo
npx prisma migrate deploy --config prisma7.config.ts
npm run start:dev
```

Default API prefix: `/api/v1`. Production listens on port **8080**.
