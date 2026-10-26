# CONSTRIQ API — project manual

This is the operator and developer guide for **constriq-api**: construction profit intelligence and project financial control.

The live API contract for the web app is [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md). Interactive explorer (when the server is running): `/docs`.

---

## 1. What CONSTRIQ is

CONSTRIQ is a **multi-tenant NestJS API**. Each registered company is a tenant. Users belong to one company, with roles and permissions.

The product north star is:

**Expected profit → forecast profit → profit at risk → why → action**

The API owns the numbers. The UI must display them, not recalculate profit.

CONSTRIQ is **not** a full accounting package. Accounting import is compare-only and never overwrites CONSTRIQ actuals. There is **no AI explain API**.

### Production pieces

| Piece | Typical value |
|---|---|
| API | NestJS 11 on Railway, prefix `/api/v1`, port **8080** |
| Database | Supabase Postgres (transaction pooler 6543 + session pooler 5432) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Web app | `https://constriq.vercel.app` (CORS) |
| Email | Brevo transactional API |
| Files | Local disk (`STORAGE_DIR`), not object storage |

---

## 2. Stack and layout

```
src/
  auth/            register, login, JWT, OTP, MFA
  identity/        permissions, roles, tenant bootstrap
  prisma/          Postgres pool (SSL / Supabase)
  mail/            Brevo
  companies/ users/ clients/
  projects/        projects, team, contacts, no-BOQ baselines
  contracts/ cost-codes/ boq/ budgets/
  variations/ costs/ forecasting/
  profit-engine/   profit, health, leakage, cash flow
  procurement/     suppliers, POs, invoices, requests
  operations/      labour, plant, equipment, subcontracts
  revenue-cycle/   progress claims, payments
  excel/ pdf/ reports/
  progress/ closeout/ scenarios/
  management/      notifications, documents, approvals, audit
  accounting/ reconciliation/
  administration/  platform admin
prisma/            schema + migrations
prisma7.config.ts  Prisma 7 CLI config (uses DIRECT_URL)
```

Money in JSON is a **string** with at most 2 decimal places (`"150000.00"`). Quantities/rates use up to 4 decimals. IDs are Prisma `cuid()`s.

---

## 3. The ten financial rules

These are enforced in the model and services. Do not bypass them in the UI.

1. **No double counting.** Actual cost, open commitment, and forecast-to-complete are mutually exclusive.
2. **Submitted variation is not revenue.** Only approved or executed variations post expected revenue (company `variationRevenueRule`).
3. **Original budget is historical.** It stays visible after revisions.
4. **Revisions change current budget only**, never original.
5. **Every actual is attributable** or flagged unallocated.
6. **Forecast-to-complete is uncommitted remaining cost** only (not actuals, not open POs).
7. **Profit at risk = expected profit − forecast profit**, stored explicitly.
8. **Material changes are auditable.** Reverse or transition; do not silent-overwrite.
9. **Raising the cost budget never increases expected revenue.**
10. **Health labels come with ranked reasons** from the API.

---

## 4. Local setup

Requirements: Node **20.19+** (dev often 22; production image is **Node 24**), npm, a Supabase (or other Postgres) database.

```bash
git clone <repo>
cd constriq-api
npm ci
copy .env.example .env   # Windows
# then fill secrets in .env
npx prisma generate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npm run start:dev
```

API: `http://localhost:8080/api/v1` (or `PORT` from `.env`; Nest default in `main.ts` is **8080**).  
Swagger: `http://localhost:8080/docs`.

### Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run build` | `prisma generate` + `nest build` |
| `npm run start:prod` | `node --dns-result-order=ipv4first dist/main.js` |
| `npm test` | Unit tests |
| `npm run test:e2e` | Boots full `AppModule` (needs a working `DATABASE_URL`) |
| `npm run prisma:migrate` | Dev migrations (`DIRECT_URL`) |
| `npm run prisma:seed` | Seed (session URL) |

---

## 5. Environment variables

Copy from `.env.example`. Never commit `.env`.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | Yes (runtime) | Supabase **transaction** pooler, port **6543**, `?pgbouncer=true` |
| `DIRECT_URL` | Yes (migrate/seed) | Supabase **session** pooler, port **5432** |
| `JWT_SECRET` | Yes | Long random string in production |
| `JWT_ACCESS_SECONDS` | No | Default `900` |
| `JWT_REFRESH_DAYS` | No | Default `7` |
| `OTP_EXPIRES_MINUTES` | No | Default `10` |
| `OTP_PEPPER` | Yes in prod | Extra hash material for OTPs |
| `BREVO_API_KEY` | Yes to send mail | Brevo SMTP API key |
| `BREVO_SENDER_NAME` | No | Default `CONSTRIQ` |
| `BREVO_SENDER_EMAIL` | Yes | Must be a **verified Brevo sender** |
| `MAIL_FROM` | No | Fallback if sender email unset |
| `CORS_ORIGIN` | No | Extra origins, comma-separated. Vercel app is allowed by default. |
| `PORT` | No | Production **8080** |
| `STORAGE_DIR` | No | Uploaded files; default under the process cwd |
| `PLATFORM_ADMIN_EMAILS` | No | Comma-separated emails for `/admin/*` |
| `APP_ORIGIN` | No | Invite links (default `http://localhost:5173`) |

Prisma CLI uses `DIRECT_URL` first (`prisma7.config.ts`). The Nest pool uses `DATABASE_URL`, then falls back to `DIRECT_URL`. SSL is encrypted with `rejectUnauthorized: false` so Railway → Supabase does not fail P1011.

Do **not** use Railway `postgres.railway.internal` from a laptop. Do **not** put `sslmode=require` on `DATABASE_URL` (node-pg treats that as full CA verify).

---

## 6. Database

1. Create a Supabase project.
2. Copy **Transaction pooler** → `DATABASE_URL` (host `*.pooler.supabase.com`, port **6543**).
3. Copy **Session pooler** → `DIRECT_URL` (same host, port **5432**).
4. Apply schema:

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

On boot, `IdentityCatalogService` syncs the global permission catalogue. If that log line is missing and you see retries, the database is unreachable.

---

## 7. Authentication and email

### Register a company (owner)

1. `POST /api/v1/auth/register` with company + owner name/email/password.
2. Password: 8–72 characters, at least one letter and one digit.
3. Response: `{ requiresVerification: true }` — **no tokens yet**.
4. User status is `INVITED` until email OTP is verified.
5. `POST /api/v1/auth/verify-email` with `{ email, otp }` → session tokens.
6. Resend: `POST /api/v1/auth/resend-otp` (rate-limited, ~60s).

Login: `POST /api/v1/auth/login`. Unverified users get `401` and a new OTP. If MFA is on, login returns `mfaRequired` until OTP is included.

Tokens: `Authorization: Bearer <accessToken>`. Refresh with `POST /api/v1/auth/refresh`. Use `GET /api/v1/auth/me` for roles and permissions.

Invite: Owner/users.manage calls `POST /api/v1/users/invite`. Invitee sets password via accept-invite / register path and verifies email.

### Brevo (OTP mail)

The API calls `https://api.brevo.com/v3/smtp/email`. Success logs `Brevo accepted email to … messageId=…`.

Checklist if mail never arrives:

1. **Authorised IPs** in Brevo — API keys can reject unknown IPs (Railway and your laptop).
2. **Sender** must be verified. `noreply@constriq.app` is rejected until the domain is authenticated (SPF/DKIM). Until then use the verified Gmail (or other) sender as `BREVO_SENDER_EMAIL`.
3. Brevo can return HTTP 201 then still **reject** an invalid sender; check Events, not only HTTP status.
4. Production must have `BREVO_API_KEY` set or register returns 500 after creating the user.

---

## 8. Roles

Created per company at register. **Owner** gets the full catalogue. Gate UI with `permissions` from `/auth/me`.

| Role | Typical use |
|---|---|
| Owner | Full tenant control |
| Project Manager | Site commercial + procurement request/create |
| Quantity Surveyor | BOQ, budget, variations, claims |
| Contracts Manager | Contracts, variations, claims |
| Commercial Manager | Approvals on budget, cost, variation, certify |
| Finance Manager | Costs, payments, dashboard |
| Accountant | Costs, procurement read, payments |
| Site Manager | Labour, costs, variation submit |
| Procurement Manager | POs, invoices, suppliers |
| Executive Read Only / Read Only | `*.read` + dashboard/reports |

Platform admin is **not** Owner. It is `PLATFORM_ADMIN_EMAILS` → `GET/PATCH /api/v1/admin/companies`.

---

## 9. How to use the product (happy path)

Do this in order for a new company.

### 9.1 Company

- `GET /companies/current`
- Settings: financial year, payment terms, retention %, `variationRevenueRule` (`APPROVED` or `EXECUTED`), forecast stale days.
- Number sequences (PO prefix, etc.).

### 9.2 People and parties

- Invite users and assign a system role.
- Create **clients** (names unique per company). Consultants are a separate list.
- Create suppliers / subcontractors when procurement or site work starts.

### 9.3 Project

Create with `POST /projects`:

- With BOQ later: set `usesBoq: true` (or omit and load a bill).
- **No BOQ:** `usesBoq: false`, plus `originalContractValue`, `expectedTotalCost`, optional `expectedCosts` breakdown (materials, labour, transport, equipment, subcontractors, other). Original vs current contract/cost stay separate; approved variations move **current** figures only.

Add team members and contacts as needed.

Statuses include `TENDER`, `AWARDED`, `ACTIVE`, `ON_HOLD`, `CLOSED`, `CANCELLED`. Closed/cancelled projects reject **writes**; reads still work.

### 9.4 Commercial setup

1. Cost codes (or copy a template). Category examples: `MATERIALS`, `LABOUR`, `SUBCONTRACTORS`, `PLANT`, …
2. Contract: original value.
3. BOQ items (qty × rate). Optional: adopt commercial into budget.
4. First budget is **original**. Later `POST .../budgets/revisions` with a reason — **current** only.

### 9.5 Live cost

| Action | Effect |
|---|---|
| Record actual cost / labour / plant | Posts **actual** |
| Create PO or subcontract (with cost code) | Posts **open commitment** |
| Match supplier invoice to PO (subtotal match) | Actual + reduces remaining commitment. Mismatch does **not** post actuals |
| Certify subcontract claim | Actual + reduces remaining commitment |
| Forecast line | **Uncommitted** remaining only |

Unallocated actuals (no cost code) are allowed; health will flag them.

### 9.6 Variations and revenue

- Create variation (`DRAFT` / submit). **Not revenue.**
- Transition to `APPROVED` or `EXECUTED` to post expected revenue (per company rule).
- Reject/withdraw reverses the posting (`isReversed`).
- Progress claims → certify → payments. Site **progress** APIs do not post money.

### 9.7 Intelligence (dashboard)

Always load from the API (they recalculate):

- `GET .../profit` — expected / forecast / profit at risk
- `GET .../health` — `HEALTHY` \| `WATCH` \| `AT_RISK` \| `CRITICAL` + reasons
- `GET .../leakage` — ranked why/action
- `GET .../cash-flow`

Do not let the UI edit those totals.

### 9.8 Import, PDFs, close

Excel: upload → suggested column map → preview → commit. Types: `BOQ`, `BUDGET`, `COST`, `FORECAST`, `VARIATION`, `CLAIM`, `COMMITMENT`.

BOQ mapping notes: a column named **Category** maps to **section**, not cost category. A **Cost Code** column maps to **item code**, not WBS cost code.

PDFs: profitability, cost, variations, claims, cash-flow, leakage.

Closeout sets project `CLOSED`. Reopen needs `company.settings`.

---

## 10. Module map (what each area does)

| Area | Does |
|---|---|
| Auth / identity | JWT, OTP, MFA, permissions, tenant roles |
| Companies / users | Tenant settings, invites |
| Clients | Unique name per company; consultants |
| Projects | Lifecycle, team, no-BOQ baselines |
| Cost codes / BOQ / budgets | Structure of cost and original vs current budget |
| Variations | Lifecycle + revenue postings |
| Costs / forecast | Actuals vs uncommitted ETC |
| Profit engine | Snapshots, health, leakage, cash flow |
| Procurement | Requests, POs, invoices, three-way match on subtotal |
| Operations | Labour, plant, equipment, subcontracts |
| Revenue cycle | IPC / certificates / receipts |
| Excel / PDF / reports | Import pipeline and downloads |
| Progress | Site programme only |
| Scenarios | What-if; apply writes forecast postings, not fake variations |
| Management | Notifications, documents, approval rules, audit |
| Accounting | GENERIC connect + reconciliation import |
| Admin | Suspend/close companies |

Full paths and bodies: [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md).

---

## 11. Deploy (Railway)

The service uses the **Dockerfile**. Start command:

```text
node --dns-result-order=ipv4first dist/main.js
```

Set on **constriq-api** (not only on Postgres):

- `DATABASE_URL` / `DIRECT_URL` (Supabase poolers)
- `JWT_SECRET`, `OTP_PEPPER`
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (verified sender)
- `CORS_ORIGIN=https://constriq.vercel.app`
- `PORT=8080`
- `PLATFORM_ADMIN_EMAILS` if you use `/admin`

Health: `GET /api/v1` returns `Hello World!`.

After schema changes, run `prisma migrate deploy` against `DIRECT_URL` (CI, one-off job, or laptop with session URL).

---

## 12. Tests

```bash
npx jest --forceExit --runInBand          # unit (src/**/*.spec.ts)
npx jest --config ./test/jest-e2e.json --forceExit --runInBand
```

Unit tests do not need Postgres. E2E boots `AppModule` and **does** need `DATABASE_URL`.

---

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| P1001 / ENOTFOUND `railway.internal` | Private hostname; use Supabase pooler or public URL |
| P1011 self-signed certificate | `sslmode=require` on the URL; app now uses no-verify + `rejectUnauthorized: false` |
| P2028 transaction timeout on register | Bootstrap too slow on pooler; register tx is 20s and permissions sync outside the tx |
| P2002 `Client_companyId_name_key` | Duplicate client name in the company (409) |
| Register 500 then OTP email anyway | Tx may have committed after client timeout; resend OTP |
| CORS blocked | API crashed (HTML error) or origin not allowed |
| `Cannot find module dist/main` | Nest emit path; Docker checks `dist/main.js` |
| Brevo 401 authorised IPs | Add Railway + laptop IPs or disable IP lock |
| Brevo 201 but no inbox | Sender not verified (`noreply@constriq.app`) |
| Identity catalog skipped | DB TLS/connect failed; API stays up for CORS/health only |
| Excel BOQ maps wrong columns | See §9.8 mapping rules |

Log lines that mean the system is healthy:

```text
Connected to Postgres at aws-0-….pooler.supabase.com:6543
Permission catalog synchronized
Nest application successfully started
Brevo accepted email to … messageId=…
```

---

## 13. Security notes

- Treat `.env` and connection strings as secrets (including chat logs).
- Rotate Brevo keys and DB passwords if they were pasted in tickets.
- JWT and OTP pepper must be unique in production.
- Extra JSON fields are rejected (`forbidNonWhitelisted`).
- Closed projects are read-only.

---

## 14. What is not in this backend

- AI insights
- Live Xero / QuickBooks OAuth (GENERIC adapter only)
- Cloud object storage
- SaaS billing
- UUID primary keys

---

## 15. Related files

| File | Role |
|---|---|
| [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) | Frontend API contract |
| [`.env.example`](./.env.example) | Env template |
| [`prisma/schema.prisma`](./prisma/schema.prisma) | Data model and the 10 rules (header) |
| [`Dockerfile`](./Dockerfile) | Production image |
| [`src/main.ts`](./src/main.ts) | Prefix, CORS, Swagger, port |
