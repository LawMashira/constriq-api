# CONSTRIQ user manual

CONSTRIQ helps a construction company see **whether a project will make the profit you expected**, **why that profit is at risk**, and **what to do next**.

Open the app at **https://constriq.vercel.app**.

CONSTRIQ is **project commercial control**, not a replacement for your accounting system. Totals on dashboards are calculated by CONSTRIQ. Do not override them in a spreadsheet and paste them back as “the real profit.”

---

## 1. What you are looking at

Every project answers the same chain:

1. **Expected profit** — what you should make if the job goes to plan (contract / approved variations minus expected cost).
2. **Forecast profit** — what you are heading for, given actuals, open orders, and remaining work.
3. **Profit at risk** — expected profit minus forecast profit (the gap).
4. **Why** — ranked reasons (leakage and health).
5. **Action** — fix the cause (unallocated costs, unmatched invoices, stale forecast, unapproved variations, and so on).

Health labels such as Healthy, Watch, At risk, or Critical always come with reasons. If there is no reason, the label is not trustworthy.

---

## 2. Sign in

### Create the company (first person)

1. Register with company legal name, your name, email, and password.
2. Password must be at least 8 characters and include a letter and a number.
3. You will **not** be signed in yet. CONSTRIQ emails a **6-digit code**.
4. Enter the code to verify your email. Then you are the **Owner**.

If the email does not arrive:

- Wait a minute and use **resend code** (there is a short wait between sends).
- Check spam and promotions.
- Confirm you used the same email you registered with.

If you registered twice, you may already have an account. Use **resend code** or **forgot password** instead of creating a second company.

### Day-to-day login

Use your email and password. If the company turned on extra sign-in protection (MFA), a code is emailed each time.

Forgot password: request a code, then set a new password.

### Invited teammates

An Owner (or someone who can manage users) invites you. You receive an invite email, set a password, verify with a code, then sign in. Your **role** decides what you can see and change.

---

## 3. Who can do what

Your company has roles. Buttons you cannot use are usually hidden. If something is missing, you probably do not have permission — ask the Owner.

| Role | Typically does |
|---|---|
| **Owner** | Everything for the company: users, settings, reopen closed jobs |
| **Project Manager** | Run the job: costs, procurement, variations, claims |
| **Quantity Surveyor** | BOQ, budgets, variations, claims |
| **Contracts Manager** | Contracts, variations, claims |
| **Commercial Manager** | Approves commercial changes (budgets, variations, certificates) |
| **Finance Manager** | Costs, payments, financial dashboards |
| **Accountant** | Record costs and payments; limited commercial change |
| **Site Manager** | Labour, site costs, submit variations |
| **Procurement Manager** | Suppliers, purchase orders, invoices |
| **Executive / Read only** | View dashboards and reports; no posting |

---

## 4. Set up the company once

After first login:

1. Check **company profile** (name, country, currency).
2. Set **defaults**: payment terms, retention %, when a variation counts as extra revenue (when **approved** vs when **executed**).
3. Invite the team and pick a role for each person.
4. Add **clients** (each client name can be used only once in your company).
5. Optionally add consultants, suppliers, and subcontractors as you need them.

---

## 5. Run a project

### Create the project

Give it a name (and a code if you use one). Link a client if you have one.

You can work in two ways:

- **With a BOQ** — load a bill of quantities, then a budget.
- **Without a BOQ** — enter the **original contract value** and **expected total cost** (optionally split into materials, labour, transport, equipment, subcontractors, other). CONSTRIQ still keeps **original** vs **current** figures as the job changes.

Add the project team and contacts (client, consultant, supplier, and so on).

### Commercial setup (recommended order)

1. **Cost codes** — the cost structure (materials, labour, subcontractors, plant, …). You can start from a template.
2. **Contract** — original contract value.
3. **BOQ** (if you use one) — items with quantity, unit, and rate.
4. **Budget** — first approved budget is the **original**. Later revisions change the **current** budget only. Original must stay visible.

Raising the cost budget **does not** increase expected revenue. Extra money in must come from the contract or **approved** variations.

### While the job is live

| You record | What CONSTRIQ treats it as |
|---|---|
| Actual cost, labour hours, plant | **Money already spent** |
| Purchase order or subcontract (with a cost code) | **Open commitment** (promised, not yet actual) |
| Supplier invoice that **matches** the PO | Becomes actual and reduces the remaining commitment |
| Invoice that **does not match** | Does **not** post as actual until you fix the match |
| Forecast to complete | **Remaining uncommitted** work only — not actuals, not open POs |
| Variation still draft or submitted | **Not revenue** |
| Variation approved or executed | Extra **expected revenue** (per company rule) |
| Progress claim certified, then payment | Money in (revenue cycle) |
| Site progress / programme | Progress only — **not** money |

You may post an actual **without** a cost code. It is allowed, but it is flagged as **unallocated** and will hurt health until you code it.

### Variations

1. Create the variation (number, title, your cost, selling price).
2. Submit it. This is **not** extra revenue yet.
3. Someone with approval rights marks it **Approved** (or **Executed**, if that is your company rule).
4. Rejected or withdrawn variations do not stay in expected revenue.

### Dashboard (check this often)

Open the project’s profit / health / leakage / cash-flow views.

You should always see:

- Expected revenue and expected profit  
- Forecast final cost and forecast profit  
- **Profit at risk**  
- A health status **and** the reasons  
- A ranked “why / action” list  

If profit at risk grows, read the reasons before changing the budget.

### Excel, PDFs, documents

- **Import** spreadsheets (BOQ, budget, costs, forecast, variations, claims, commitments). Upload → check the column matching → preview errors → commit. Do not approve variations via import; approve them in the app so revenue posts correctly.
- **Export** workbooks and **PDF** packs (profitability, cost, variations, claims, cash flow, leakage).
- **Documents** attach files to the project, a PO, a claim, and similar records.

A BOQ column named **Category** is treated as a **section** (e.g. Earthworks), not a cost type. A column named **Cost Code** on a BOQ is treated as the **item number**, not the company’s WBS cost code.

### Close the job

Use **closeout** when the job is finished (you can add lessons learned). The project becomes read-only. Reopening needs Owner / company settings access.

---

## 6. Rules that never change

Keep these in mind; CONSTRIQ enforces them.

1. Do not count the same money as actual **and** open order **and** forecast.
2. A submitted variation is not extra income.
3. Original budget remains after revisions.
4. Revisions change current budget only.
5. Uncoded actuals are allowed but must stay visible.
6. Forecast-to-complete is leftover **uncommitted** cost.
7. Profit at risk is expected profit minus forecast profit.
8. Do not silently overwrite history; use revisions, approvals, and transitions.
9. A higher cost budget is not extra revenue.
10. Every health label needs a reason.

Accounting import is for **comparison** only. It does not replace CONSTRIQ actuals.

---

## 7. Everyday problems

| What you see | What to do |
|---|---|
| No verification email | Spam folder, resend code, confirm the sender is allowed by your mail filters |
| “Account already exists” | Sign in or reset password |
| “Wait before requesting another code” | Wait about a minute |
| Cannot create a client | That name already exists in your company — search for it |
| Cannot edit a project | It may be **closed** or **cancelled**, or your role is read-only |
| Invoice saved but cost did not move | It did not **match** the purchase order — fix quantities/rates/subtotal |
| Profit looks “wrong” | Do not type a new total. Check actuals, open POs, forecast, and unapproved variations |
| Import failed | Fix the preview errors (required columns, numbers, dates) then commit again |
| A button is missing | You do not have that permission — ask the Owner |

---

## 8. What CONSTRIQ does not do

- It is not your general ledger or tax return.
- It does not auto-sync live Xero / Sage / QuickBooks as a two-way books system (import is for checking).
- It does not invent profit with AI.
- It does not replace signed contracts or statutory reporting.

---

Use CONSTRIQ to keep **one commercial story** per project: what you sold, what you have spent, what you have promised, what is left, and whether profit is slipping — with a reason attached.