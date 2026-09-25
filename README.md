# Aakash Business ERP

Multi-tenant ERP for Nepal - Supabase/PostgreSQL, Node/Express, React 18 + Tailwind.

## Structure
- `database/` - SQL migrations, run in number order (01 -> 124)
- `server/` - Express API (`server.js`, `routes/`, `utils/`, `middleware/`)
- `client/` - React app (`src/pages`, `src/components`, `src/hooks`)

## Setup
1. **Database** - run every file in `database/` in number order on the tenant database (a fresh database: all of them; an existing one: only the new ones).
2. **Server**
   ```bash
   cd server
   cp .env.example .env      # fill in real values; .env is git-ignored
   npm install
   node scripts/check-nepali-dates.js   # all PASS = Nepali calendar package active
   npm start
   ```
3. **Client**
   ```bash
   cd client
   cp .env.example .env
   npm install
   npm start
   npm run typecheck        # TypeScript check (tsc --noEmit)
   ```
   The client is React + **Tailwind CSS** and is moving to **TypeScript** step by step: `tsconfig.json` has `allowJs`, so the existing `.jsx` pages keep working while new modules are `.ts` / `.tsx` (shared types in `src/types/erp.ts`).

## Default sign-in details
| Who | Company code | Email | Password |
|---|---|---|---|
| Super Admin (all companies) | leave blank | `superadmin@businesserp.com.np` | `Super@12345` |
| Admin of every new company | the company's code (shown when the company is created, e.g. `aakash_123456`) | `admin@businesserp.com.np` | `Admin@12345` |

- The super admin is created by `database/124_default_admin_logins_schema.sql` (run it on the global database) only when no super admin exists yet.
- Every company created from Company Creation gets the same default admin login plus the Administrators / Managers / Users security groups. The server settings `DEFAULT_TENANT_ADMIN_EMAIL` and `DEFAULT_TENANT_ADMIN_PASSWORD` change the defaults.
- Both default passwords **must be changed at the first sign-in** (the ERP opens "Set your password" and nothing else until it is done). Because the admin email is the same in every company, the sign-in page asks for the company code.

## Screens that work the same everywhere
- **Enter = next field** on every screen (entry forms, report filter bars, settings); Enter on the last filter of a report runs its Show button.
- **Spreadsheet-style column filter (▾)** on every report table: sort, search, tick values. Add `data-no-excel` to a table to opt out.
- **Audit log** (database/121): a database trigger records every create / change / delete on every master and entry table (135 tables, line rows linked to their document) with old -> new values, user, IP and screen. See it under Setup -> Audit Log, or the 🕘 / History button on each list. Tables added in later migrations: run `SELECT tenant_master.audit_attach_all();`.
- **Data access** (database/122, Setup -> Data Access): per user or security group, which ledgers / sub-ledgers / products / product companies / product groups / customer categories / areas may be seen. Applied on the server to every list, picker, document list, report (totals too) and save. Company admins are never restricted.
- **Office work** (database/123): Darta / Chalani register (numbered per fiscal year, BS dates, assign, reply link), Tasks (assign, watchers, due, repeat, comments, board), Work Dashboard, and notifications - 🔔 bell + popup in the ERP, copies by email / SMS / WhatsApp / Viber per user (My Notification Settings) through the Messaging gateways. Rights: security group modules `darta_chalani`, `tasks`, `data_access`.
- **Dashboard**: pick widgets (KPIs, trends, top lists, ageing, cash, stock), chart type (bar / line / area / pie / donut / horizontal bar / table), size and period; save per user or as the company default.

## Highlights
Sales / purchase cycle with dual & multi unit, billing terms with sub-ledgers, VAT reports, Entry Field Control (user / group, enforced on the server), Product Company rules, Party Summary, Financial Reports (Trial Balance, P&L, Balance Sheet, Ratios, Cash / Funds Flow, Notes, Budget vs Actual) and Stock Movement - all financial and stock figures come from shared engines (`server/utils/financialEngine.js`, `server/utils/stockEngine.js`) so reports always agree.

See `README_FIXES.md` for the detailed change history.
