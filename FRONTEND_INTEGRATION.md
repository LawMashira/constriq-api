# CONSTRIQ API — frontend integration

This document describes the NestJS API as implemented today. Use it as the contract for the web app. Do not invent financial numbers or extra rules in the UI.

Interactive explorer (when the API is running): `GET /api/v1/docs`

---

## 1. Base URL and transport

| Item | Value |
|---|---|
| Prefix | `/api/v1` |
| Default origin | `http://localhost:3000` |
| Example | `http://localhost:3000/api/v1/projects` |
| Content type | `application/json` unless noted (multipart for files) |
| Auth | `Authorization: Bearer <accessToken>` on every non-public route |
| CORS | `CORS_ORIGIN` comma-separated, or all origins if unset |

Unknown JSON fields are **rejected** (`forbidNonWhitelisted`). Extra properties in request bodies will 400.

---

## 2. Money, dates, IDs

- **Money** is a **string** with at most 2 decimal places: `"150000.00"`, `"-12.50"`. Never send JS floats.
- **Quantities / rates** (hours, BOQ qty, unit rates, retention %) are strings with at most 4 decimal places: `"12.5000"`.
- **Dates** are ISO-8601 strings (`2026-09-30` or full datetime).
- **IDs** are Prisma `cuid()` strings, not UUIDs.
- Prisma `Decimal` fields in JSON usually come back as **strings**. Display them; do not round in the client for stored values.
- Profit **percentages** (margins) are strings with 4 decimal places, e.g. `"12.3456"`, or `null` when expected revenue is zero.

---

## 3. Errors

Typical Nest JSON:

```json
{ "statusCode": 401, "message": "Invalid email or password", "error": "Unauthorized" }
```

| Status | Meaning |
|---|---|
| 400 | Validation or domain rule (closed project, duplicate invoice, submitted variation is not revenue, etc.) |
| 401 | Missing/invalid/expired token, bad password, unverified email |
| 403 | Authenticated but missing a permission, or not a platform admin |
| 404 | Tenant-scoped record not found |
| 409 | Duplicate unique (e.g. project code) |

Closed or cancelled projects reject **writes** (`400`). Reads still work.

---

## 4. Authentication

Public routes (no Bearer token):

- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/resend-otp`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /` (health string)

Access tokens expire in ~15 minutes (`JWT_ACCESS_SECONDS`). Store **refreshToken** securely and rotate via `POST /auth/refresh` (`{ "refreshToken": "..." }`). On 401 from a protected call, refresh then retry once.

### 4.1 Register company + owner

```http
POST /api/v1/auth/register
```

```json
{
  "companyLegalName": "Acme Construction (Pty) Ltd",
  "tradingName": "Acme",
  "country": "ZA",
  "currency": "ZAR",
  "name": "Jane Owner",
  "email": "jane@acme.co.za",
  "password": "Secret123"
}
```

Password: min 8, max 72, at least one letter and one digit.

Response: `{ "message": "...", "email": "...", "requiresVerification": true }`. No tokens yet.

### 4.2 Verify email

```json
{ "email": "jane@acme.co.za", "otp": "123456" }
```

OTP is always 6 digits. Success returns a **session** (see 4.4).

### 4.3 Login and MFA

```json
{ "email": "jane@acme.co.za", "password": "Secret123" }
```

If email is not verified: `401` and a new OTP is sent.

If MFA is enabled and `otp` is omitted:

```json
{
  "mfaRequired": true,
  "email": "jane@acme.co.za",
  "message": "Enter the sign-in code sent to your email"
}
```

Then retry login with the same password **and** `"otp": "123456"`.

### 4.4 Session payload

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "...",
    "name": "Jane Owner",
    "email": "jane@acme.co.za",
    "companyId": "...",
    "status": "ACTIVE"
  }
}
```

Use `GET /auth/me` after login for **permissions** (needed to hide/disable UI):

```json
{
  "id": "...",
  "name": "...",
  "email": "...",
  "status": "ACTIVE",
  "emailVerifiedAt": "...",
  "mfaEnabled": false,
  "company": { "id": "...", "legalName": "...", "currency": "ZAR", "country": "ZA", "status": "ACTIVE" },
  "roles": ["OWNER"],
  "permissions": ["project.read", "budget.create", "..."],
  "memberships": [{ "companyId": "...", "status": "ACTIVE" }]
}
```

Gate every screen with `permissions.includes('...')`. Do not assume OWNER from the UI; the API enforces it.

### 4.5 MFA (authenticated)

| Method | Path | Body |
|---|---|---|
| POST | `/auth/mfa/enable` | — (sends email OTP) |
| POST | `/auth/mfa/confirm` | `{ "otp": "123456" }` |
| POST | `/auth/mfa/disable` | `{ "password": "..." }` |

### 4.6 Other auth

| Method | Path | Body |
|---|---|---|
| POST | `/auth/logout` | — |
| POST | `/auth/logout-all` | — |
| POST | `/auth/forgot-password` | `{ "email": "..." }` |
| POST | `/auth/reset-password` | `{ "email", "otp", "password" }` |
| POST | `/auth/change-password` | `{ "currentPassword", "newPassword" }` |

---

## 5. Permissions

If a route lists a permission, the user must have **all** listed codes. Routes without `@RequirePermissions` only need a valid JWT (e.g. notifications, some approval requests).

| Code | Typical UI |
|---|---|
| `project.read` / `create` / `update` / `delete` | Projects |
| `client.read` / `create` / `update` | Clients, consultants |
| `contract.read` / `create` / `update` | Contracts |
| `cost_code.read` / `create` / `update` | Cost codes, templates |
| `budget.read` / `create` / `update` / `approve` | BOQ, budgets, revisions, scenario apply |
| `cost.read` / `create` / `update` / `approve` | Actuals, plant, equipment, subcontract certify |
| `procurement.read` / `create` / `approve` | Suppliers, POs, invoices, requests |
| `subcontractor.read` / `create` | Subcontractors, subcontracts, SC claims |
| `labour.read` / `create` | Workers, timesheets |
| `variation.read` / `create` / `submit` / `approve` | Variations |
| `claim.read` / `create` / `submit` / `certify` | Progress claims |
| `payment.read` / `create` / `approve` | Payments |
| `financial_dashboard.read` | Profit, health, leakage, cash flow, forecast, scenarios, company financials |
| `reports.read` | Excel import/export, PDFs, JSON reports, history, accounting status |
| `document.read` / `create` | Documents |
| `audit.read` | Audit log |
| `company.settings` | Company profile, sequences, approval rules, closeout reopen |
| `users.manage` | User list and invite |

Read-only roles only receive `*.read` (plus dashboard/reports). Hide write buttons when the code is missing.

---

## 6. Recommended screens → APIs

Suggested product flow (matches the financial model):

1. **Auth** → register / verify / login / MFA.
2. **Company** → `GET /companies/current`, settings, sequences.
3. **Users** → `GET /users`, `POST /users/invite`.
4. **Clients / consultants** → CRUD-style list/create.
5. **Projects** → list, create, detail, team, contacts.
6. **Setup on a project** → cost codes (or from template), contract, BOQ, original budget.
7. **Live commercial** → actuals, suppliers/POs/invoices, labour, plant, variations, forecast.
8. **Intelligence** → `GET .../profit`, `health`, `leakage`, `cash-flow` (this is the north star).
9. **Revenue** → progress claims, certify, payments.
10. **Import / reports** → Excel pipeline, PDF downloads, `GET .../reports/:type`.
11. **Close** → closeout; reopen needs `company.settings`.

**Do not** let the UI “fix” profit by editing totals. Totals come from postings after the engine recalculates.

---

## 7. Endpoint catalogue

All paths below are relative to `/api/v1`. Auth = Bearer unless **Public**.

### Company and users

| Method | Path | Permission |
|---|---|---|
| GET | `/companies/current` | JWT |
| PATCH | `/companies/current` | `company.settings` |
| PATCH | `/companies/current/settings` | `company.settings` |
| GET | `/companies/current/financials` | `financial_dashboard.read` |
| GET | `/companies/current/sequences` | `company.settings` |
| POST | `/companies/current/sequences` | `company.settings` |
| GET | `/users` | `users.manage` |
| POST | `/users/invite` | `users.manage` |

Invite body: `{ "name", "email", "roleId"? }`. Invited users complete register/verify with the same email.

Settings (all optional): `financialYearStartMonth` (1–12), `defaultPaymentTermsDays`, `defaultRetentionPercent`, `variationRevenueRule` (`APPROVED` \| `EXECUTED`), `forecastStaleDays`, `taxInclusiveDefault`.

Sequence body: `{ "entityType": "PURCHASE_ORDER", "prefix": "PO", "nextNumber"?: 1, "padding"?: 5 }`.

### Clients and consultants

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/clients` | `client.read` / `client.create` |
| GET | `/clients/:id` | `client.read` |
| GET/POST | `/consultants` | `client.read` / `client.create` |

Create body: `{ "name", "registrationNo"?, "taxNumber"?, "email"?, "phone"?, "address"? }`.

### Projects

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/projects` | `project.read` / `project.create` |
| GET/PATCH | `/projects/:projectId` | `project.read` / `project.update` |
| GET/POST | `/projects/:projectId/team` | `project.read` / `project.update` |
| POST | `/projects/:projectId/contacts` | `project.update` |

Create project: `{ "code", "name", "clientId"?, "projectManagerId"?, "siteAddress"?, "contractNo"?, "projectType"?, "status"?, "contractStartDate"?, "plannedCompletionDate"?, "notes"? }`.

`projectType`: `BUILDING` \| `CIVIL` \| `INFRASTRUCTURE` \| `INDUSTRIAL` \| `RESIDENTIAL` \| `REFURBISHMENT` \| `OTHER`.

`status`: `TENDER` \| `AWARDED` \| `MOBILISATION` \| `ACTIVE` \| `ON_HOLD` \| `PRACTICAL_COMPLETION` \| `CLOSED` \| `CANCELLED`.

Team: `{ "userId", "roleId"? }`. Contact: `{ "partyType", "name", "email"?, "phone"?, "role"? }` where `partyType` is `CLIENT` \| `SUPPLIER` \| `SUBCONTRACTOR` \| `CONSULTANT` \| `EMPLOYEE` \| `OTHER`.

### Cost codes, BOQ, contracts, budgets

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/cost-code-templates` | `cost_code.read` / `create` |
| GET/POST | `/projects/:projectId/cost-codes` | `cost_code.read` / `create` |
| PATCH | `/projects/:projectId/cost-codes/:id` | `cost_code.update` |
| POST | `/projects/:projectId/cost-codes/from-template/:templateId` | `cost_code.create` |
| GET/POST | `/projects/:projectId/contracts` | `contract.read` / `create` |
| GET/POST | `/projects/:projectId/boq` | `budget.read` / `create` |
| PATCH | `/projects/:projectId/boq/items/:itemId` | `budget.update` |
| GET/POST | `/projects/:projectId/budgets` | `budget.read` / `create` |
| POST | `/projects/:projectId/budgets/revisions` | `budget.approve` |

Cost code: `{ "code", "name", "category"?, "description"? }`.  
`category`: `MATERIALS` \| `LABOUR` \| `SUBCONTRACTORS` \| `PLANT` \| `EQUIPMENT` \| `TRANSPORT` \| `PROFESSIONAL_SERVICES` \| `SITE_OVERHEADS` \| `GENERAL_EXPENSES` \| `PRELIMINARIES` \| `OTHER`.

Contract: `{ "contractNo", "title", "originalValue", "startDate"?, "endDate"? }`.

BOQ create:

```json
{
  "name": "Bill 1",
  "items": [
    { "itemCode": "A1", "description": "...", "section"?: "...", "costCodeId"?: "...", "quantity": "10.0000", "unit"?: "m2", "rate": "150.0000" }
  ]
}
```

Budget: `{ "lines": [{ "costCodeId", "amount" }] }`. First approved budget is **original** and stays visible. Later `POST .../budgets/revisions` with `{ "reason", "lines" }` changes **current** only, never original.

### Variations

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/projects/:projectId/variations` | `variation.read` / `create` |
| POST | `/projects/:projectId/variations/:variationId/transition` | `variation.approve` |

Create: `{ "variationNo", "title", "contractorCost", "sellingPrice", ...optional }`.

Transition: `{ "status": "SUBMITTED" | "APPROVED" | "REJECTED" | "EXECUTED" | "CANCELLED" | "DRAFT" }`.

**UI rule:** Submitted / draft is **not revenue**. Only `APPROVED` or `EXECUTED` posts expected revenue, depending on company `variationRevenueRule`. Do not add selling price into expected revenue in the client.

### Actual costs and forecast

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/projects/:projectId/costs` | `cost.read` / `create` |
| GET/POST | `/projects/:projectId/forecast` | `financial_dashboard.read` / `cost.create` |

Cost: `{ "description", "amount", "transactionDate", "costCodeId"?, "supplierId"?, "reference"? }`. Omit `costCodeId` to flag **unallocated** (allowed; health will warn).

Forecast: `{ "costCodeId", "amount", "reason", "period" }`. Amount is **uncommitted remaining cost only**, not actuals and not open PO remaining.

### Profit intelligence (primary dashboard)

| Method | Path | Permission |
|---|---|---|
| GET | `/projects/:projectId/profit` | `financial_dashboard.read` |
| GET | `/projects/:projectId/health` | same |
| GET | `/projects/:projectId/leakage` | same |
| GET | `/projects/:projectId/cash-flow` | same |

These **recalculate** server-side. Always show:

- Expected revenue / expected profit  
- Forecast final cost / forecast profit  
- **Profit at risk** (expected − forecast)  
- **Health** + ranked **reasons** (`health.reasons[]`)  
- Leakage list for the “why / action” panel  

Example profit JSON:

```json
{
  "expectedRevenue": "1000000.00",
  "expectedProfit": "150000.00",
  "forecastFinalCost": "900000.00",
  "forecastProfit": "100000.00",
  "profitAtRisk": "50000.00",
  "forecastMargin": "10.0000",
  "originalBudget": "850000.00",
  "currentBudget": "870000.00",
  "actualCost": "400000.00",
  "openCommittedCost": "200000.00",
  "forecastUncommittedCost": "300000.00",
  "contributors": [{ "category": "ACTUAL", "amount": "400000.00" }]
}
```

Health: `{ "status": "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL", "reasons": [{ "type", "amount", "description" }] }`.

### Procurement

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/suppliers` | `procurement.read` / `create` |
| GET/POST | `/projects/:projectId/purchase-orders` | read / create |
| GET/POST | `/projects/:projectId/supplier-invoices` | read / create |
| GET/POST | `/projects/:projectId/procurement-requests` | read / create |
| POST | `/projects/:projectId/procurement-requests/:requestId/convert` | `procurement.approve` |

PO: `{ "supplierId", "poNumber"?, "lines": [{ "costCodeId", "description", "quantity", "unitRate" }] }`. Creating a PO **posts open commitment**.

Invoice: `{ "supplierId", "purchaseOrderId"?, "invoiceNumber", "invoiceDate", "subtotal", "taxAmount", "lines": [{ "purchaseOrderLineId"?, "costCodeId"?, "description", "quantity", "unitRate" }] }`.

Matched invoices post **actuals** and reduce remaining commitment. Show `match` in the response; mismatches do **not** post actuals. Duplicate `(supplierId, invoiceNumber)` → 400.

### Operations (labour, plant, subcontract)

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/subcontractors` | `subcontractor.read` / `create` |
| GET/POST | `/projects/:projectId/subcontracts` | same |
| GET/POST | `/projects/:projectId/subcontract-claims` | same |
| POST | `/projects/:projectId/subcontract-claims/:claimId/certify` | `cost.approve` |
| GET/POST | `/labour/workers` | `labour.read` / `create` |
| GET/POST | `/projects/:projectId/labour` | same |
| GET/POST | `/equipment` | `cost.read` / `create` |
| POST | `/projects/:projectId/equipment-allocations` | `cost.create` |
| GET/POST | `/projects/:projectId/plant` | `cost.read` / `create` |

Labour: `{ "workerId", "costCodeId", "workDate", "hours", "rate", "overtimeHours"? }` — posts actual cost.

Plant: `{ "description", "workDate", "amount", "equipmentId"?, "costCodeId"?, ... }` — posts actual cost.

Subcontract: `{ "subcontractorId", "description", "originalValue", "costCodeId"?, "contractNo"?, "scope"?, "retentionPercent"? }` — posts commitment if `costCodeId` set.

Certify SC claim: `{ "certifiedAmount": "10000.00" }` — posts actual and reduces remaining commitment.

### Progress (site, not cost)

| Method | Path | Permission |
|---|---|---|
| GET | `/projects/:projectId/progress` | `project.read` |
| POST | `.../progress/work-packages` | `project.update` |
| POST | `.../progress/activities` | `project.update` |
| POST | `.../progress/milestones` | `project.update` |
| PATCH | `.../progress/milestones/:milestoneId/complete` | `project.update` |
| POST | `.../progress/records` | `project.update` |

Progress **does not** post money. Claims use the revenue-cycle APIs.

### Revenue cycle

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/projects/:projectId/progress-claims` | `claim.read` / `create` |
| POST | `/projects/:projectId/progress-claims/:claimId/certify` | `claim.certify` |
| GET/POST | `/projects/:projectId/payments` | `payment.read` / `create` |

Create claim: `{ "claimNo", "periodStart", "periodEnd", "workCompleted", "retentionAmount" }`.

Certify: `{ "certificateNo", "certifiedAmount", "amountRejected"? }`.

Payment: `{ "amount", "paymentDate", "supplierInvoiceId"?, "certificationId"?, "reference"? }`.

### Scenarios, closeout, history

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/projects/:projectId/scenarios` | dashboard / `cost.create` |
| POST | `/projects/:projectId/scenarios/:scenarioId/apply` | `budget.approve` |
| GET/POST | `/projects/:projectId/closeout` | `project.read` / `update` |
| POST | `/projects/:projectId/closeout/reopen` | `company.settings` |
| GET | `/history/cost-rates` | `reports.read` |
| GET | `/history/outcomes` | `reports.read` |

Scenario create:

```json
{
  "name": "Steel increase",
  "description": "...",
  "adjustments": [
    {
      "adjustmentType": "MATERIAL_PRICE_CHANGE",
      "costAdjustment": "50000.00",
      "revenueAdjustment": "0.00",
      "costCodeId": "...",
      "description": "..."
    }
  ]
}
```

What-if numbers are stored on the scenario. **Apply** writes forecast postings for cost adjustments with a `costCodeId`. It does **not** auto-approve variations.

Closeout body: `{ "lessonsLearned"? }`. Sets project `CLOSED`. Reopen returns it to `ACTIVE`.

### Excel import (flexible column mapping)

Types: `BOQ` \| `BUDGET` \| `COST` \| `FORECAST` \| `VARIATION` \| `CLAIM` \| `COMMITMENT`.

| Method | Path | Notes |
|---|---|---|
| GET | `/imports/fields?type=BOQ` | Field catalogue + aliases |
| GET | `/imports/template?type=BOQ` | `.xlsx` download |
| GET | `/projects/:projectId/imports` | List |
| POST | `/projects/:projectId/imports?type=BOQ&sheet=` | `multipart/form-data` field **`file`** |
| GET | `/imports/:id` | Status, suggested map, preview |
| PATCH | `/imports/:id/mapping` | Save map + preview/validate |
| POST | `/imports/:id/commit` | Write after preview is clean |
| GET | `/projects/:projectId/exports/xlsx` | Live project workbook |

Upload: `Content-Type: multipart/form-data`, file field name **`file`**. Max 15MB. `.xlsx` / `.xlsm` / `.csv`.

Mapping body:

```json
{
  "columnMap": {
    "itemCode": "Item No",
    "description": "B",
    "quantity": 3
  },
  "createMissingCostCodes": true,
  "createMissingSuppliers": true
}
```

Each map value is a **header name**, a **column letter** (`A`, `B`), or a **0-based index**.

**UX:** Upload → show suggested `columnMap` → user can map any column to any field → preview errors → commit. Imported variations must stay `DRAFT` or `SUBMITTED`; approve in-app so revenue posts correctly.

### PDFs and JSON reports

PDFs (`Content-Type: application/pdf`, attachment):

- `GET /projects/:projectId/pdf/profitability`
- `GET /projects/:projectId/pdf/cost`
- `GET /projects/:projectId/pdf/variations`
- `GET /projects/:projectId/pdf/claims`
- `GET /projects/:projectId/pdf/cash-flow`
- `GET /projects/:projectId/pdf/leakage`

JSON: `GET /projects/:projectId/reports/:type`  
`:type` examples: `profitability`, `cost`, `variation_schedule`, `cash_flow`, `leakage` (case-insensitive, hyphens allowed).

### Documents, notifications, approvals, audit

| Method | Path | Permission |
|---|---|---|
| GET | `/notifications` | JWT |
| PATCH | `/notifications/:id/read` | JWT |
| GET | `/documents?projectId=` | `document.read` |
| POST | `/documents` | `document.create` (multipart) |
| GET | `/documents/:id/file` | `document.read` (binary) |
| GET/POST | `/approval-rules` | `company.settings` |
| GET | `/approvals?projectId=` | JWT |
| POST | `/approvals` | JWT |
| POST | `/approvals/:id/decide` | JWT + approve/settings/owner |
| GET | `/audit-logs` | `audit.read` |

Document upload: multipart field **`file`**, plus fields `entityType`, `entityId`, optional `projectId`, `kind`, `name`.

`entityType` examples: `PROJECT`, `VARIATION`, `PURCHASE_ORDER`, `PROGRESS_CLAIM`, `DOCUMENT`, … (Prisma `EntityType`).

`kind`: `CONTRACT` \| `BOQ` \| `PURCHASE_ORDER` \| `SUPPLIER_INVOICE` \| `SUBCONTRACT` \| `CLAIM` \| `CERTIFICATE` \| `VARIATION` \| `DRAWING` \| `SITE_PHOTO` \| `DELIVERY_NOTE` \| `TIMESHEET` \| `CORRESPONDENCE` \| `REPORT` \| `BUDGET_REVISION` \| `OTHER`.

Approval request: `{ "entityType", "entityId", "projectId"?, "amount"?, "comments"? }`.  
`entityType`: `BUDGET_REVISION` \| `PURCHASE_ORDER` \| `COMMITMENT` \| `SUPPLIER_INVOICE` \| `VARIATION` \| `SUBCONTRACT_CLAIM` \| `PROGRESS_CLAIM` \| `PAYMENT` \| `PROCUREMENT`.

Decide: `{ "status": "APPROVED" | "REJECTED", "comments"? }`.

Rule: `{ "entityType", "minAmount", "maxAmount"?, "roleId" }`.

### Reconciliation and accounting

| Method | Path | Permission |
|---|---|---|
| GET | `/projects/:projectId/reconciliation` | `reports.read` |
| POST | `/projects/:projectId/reconciliation/accounting-costs` | `cost.read` |
| GET | `/accounting/status` | `reports.read` |
| POST | `/accounting/connect` | `company.settings` |
| POST | `/accounting/disconnect` | `company.settings` |
| POST | `/accounting/import/costs` | `cost.read` |

Accounting **never overwrites** CONSTRIQ actuals. Import is compare-only. Connect body: `{ "provider": "GENERIC" | "XERO" | "QUICKBOOKS" | "SAGE" | "PASTEL" | "OTHER" }` (GENERIC is the implemented adapter).

### Platform admin (not company OWNER)

Set `PLATFORM_ADMIN_EMAILS` to a comma-separated list of emails.

| Method | Path |
|---|---|
| GET | `/admin/companies` |
| PATCH | `/admin/companies/:id` `{ "status": "ACTIVE" \| "SUSPENDED" \| "CLOSED" }` |

Everyone else gets `403`.

---

## 8. Financial rules the UI must honour

1. Do not double-count actual, open commitment, and forecast-to-complete.
2. Submitted variation ≠ revenue.
3. Show original budget after revisions.
4. Revisions change current budget only.
5. Unallocated actuals are allowed but must be visible/flagged.
6. Forecast-to-complete is remaining **uncommitted** cost.
7. Always show profit at risk = expected profit − forecast profit (API stores it).
8. Do not silently overwrite; use transitions, revisions, imports with audit.
9. Raising the cost budget never increases expected revenue.
10. Health labels always come with ranked leakage / reasons from the API.

CONSTRIQ is **not** an accounting package. Accounting import is for reconciliation only.

There is **no AI calculate-or-explain API**. Do not add a client-side “AI profit” calculator.

---

## 9. Suggested TypeScript client sketch

```ts
const api = async (path: string, init: RequestInit = {}) => {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) { /* refresh then retry once */ }
  if (!res.ok) throw await res.json();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json();
  return res.blob(); // pdf / xlsx
};
```

After login, cache `permissions` from `/auth/me` and re-fetch on focus if the token was refreshed.

---

## 10. Not in this backend (yet)

- AI insights / natural-language explain layer
- Live Xero / QuickBooks OAuth (GENERIC connect + import only)
- Object storage (files sit on local `STORAGE_DIR`)
- SaaS billing / plans
- UUID primary keys

If a screen needs one of these, keep it out of the first frontend or treat it as a stub.
