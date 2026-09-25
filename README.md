# Aakash Business ERP

Multi-tenant ERP for Nepal - Supabase/PostgreSQL, Node/Express, React 18 + Tailwind.

## Structure
- `database/` - SQL migrations, run in number order (01 -> 116)
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
   ```

## Highlights
Sales / purchase cycle with dual & multi unit, billing terms with sub-ledgers, VAT reports, Entry Field Control (user / group, enforced on the server), Product Company rules, Party Summary, Financial Reports (Trial Balance, P&L, Balance Sheet, Ratios, Cash / Funds Flow, Notes, Budget vs Actual) and Stock Movement - all financial and stock figures come from shared engines (`server/utils/financialEngine.js`, `server/utils/stockEngine.js`) so reports always agree.

See `README_FIXES.md` for the detailed change history.
