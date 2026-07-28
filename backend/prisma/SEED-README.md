# GudMed — Demo Setup (for a fresh machine)

One command seeds everything. Follow these steps in order.

## Prerequisites
- **Node.js** 18+ installed
- **PostgreSQL** running, and an empty database created (e.g. `hospital_db`)

## Steps

```bash
# 1. Go into the backend
cd backend

# 2. Install dependencies
npm install

# 3. Create backend/.env with your database URL
#    (replace user/password/host/dbname with yours)
#    DATABASE_URL="postgresql://postgres:password@localhost:5432/hospital_db"

# 4. Create all tables
npx prisma migrate deploy

# 5. Seed the demo data  (safe to run more than once)
npx prisma db seed
```

That's it. Now start the app:

```bash
# Backend (from backend/)
npm run dev

# Frontend (from the project root, in another terminal)
npm install
npm run dev
```

Open **http://localhost:5173**

## Login (same password for every demo account)
| Role       | Email                  | Password     |
|------------|------------------------|--------------|
| Admin      | admin@gudmed.in        | `Gudmed@123` |
| Reception  | reception@gudmed.in    | `Gudmed@123` |
| Doctor     | dr.card.1@gudmed.in    | `Gudmed@123` |

## Notes
- The seed is **idempotent** — running `npx prisma db seed` again will **not**
  duplicate anything or crash. It only adds what's missing.
- It creates: 1 hospital, 10 departments, 20 doctors (with fees + commission),
  admin + receptionist, 3 wards, 10 rooms across 4 floors, 30 patients, and
  30 sample appointments/invoices/commissions.
- Only ONE seed file matters now: `backend/prisma/seed.js`.
