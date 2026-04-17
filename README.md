# 📚 Ridi Discount Tracker

A full-stack app that tracks Ridibooks set book prices and discount periods, with a SteamDB-style dashboard.

Three components:
- **Scraper** (Python) — hits Ridibooks' list + detail pages daily, upserts into Postgres
- **Database** — PostgreSQL (Docker locally, Neon serverless in production)
- **Frontend** (Next.js App Router) — SSR dashboard, book detail w/ price chart, sale-end calendar

Production stack: **Neon** (Postgres) + **Cloudflare Pages** (frontend) + **GitHub Actions** (scheduled scraper).

---

## Local Development

### 1. Prerequisites
- **Docker & Docker Compose** — for local Postgres
- **Python 3.11+** — for the scraper
- **Node.js 20+ & npm** — for the frontend

### 2. Environment
Create `.env` at repo root:

```env
DB_USER=yourpassword
DB_PASSWORD=yourpassword
DB_NAME=ridi_db
DB_HOST=localhost
DB_PORT=5432
DB_SSLMODE=disable

DATABASE_URL="postgresql://[user]:[password]@localhost:5432/ridi_db?schema=public"
```

Also create `frontend/.env` and `frontend/.env.local` with the same `DATABASE_URL` (Prisma CLI reads `.env`, Next.js runtime reads `.env.local`).

`docker-compose.yml` is gitignored — create your own based on standard `postgres:16` + `dpage/pgadmin4` images.

### 3. Start Postgres
```bash
docker-compose up -d
```

### 4. Scraper
```bash
cd scraper
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install requests curl_cffi psycopg2-binary python-dotenv
python scraper.py
```

> The scraper uses `curl_cffi` with a Chrome TLS fingerprint to bypass Cloudflare bot detection on Ridibooks' detail pages. Expect ~2.5s delay per book.

### 5. Frontend
```bash
cd frontend
npm install
npx prisma generate
npx prisma db push                  # Sync schema to DB (no migrations)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Production Deployment

### Database — Neon
1. We use [neon.tech](https://neon.tech)
2. Grab **two** connection strings from the dashboard:
   - **Pooler** (`...-pooler.<region>...`) — for Next.js runtime
   - **Direct** (strip `-pooler`) — for Prisma CLI (`db push`) and the scraper
3. Push schema once from local: `cd frontend && npx prisma db push` (uses direct endpoint from `frontend/.env`)

### Frontend — Cloudflare Pages
1. Push repo to GitHub
2. In Cloudflare Pages: **Create project → Connect GitHub repo**
3. Build settings:
   - **Root directory:** `frontend`
   - **Build command:** `npm run pages:build`
   - **Build output:** `.vercel/output/static`
   - **Compatibility flag:** `nodejs_compat`
4. Environment variables:
   - `DATABASE_URL` — **pooler** endpoint
   - `NEXT_PUBLIC_SITE_URL` — your Pages URL (for sitemap)

The frontend uses `@prisma/adapter-neon` (HTTP driver) so it runs fully on Cloudflare's edge runtime — no Node sockets needed.

### Scraper — GitHub Actions
Daily cron at KST 12:00 (`0 3 * * *` UTC), defined in `.github/workflows/scraper.yml`.

Add these repo secrets (**Settings → Secrets and variables → Actions**):
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`

Use the **direct** (non-pooler) Neon endpoint for `DB_HOST` since psycopg2 is a native socket driver. `DB_SSLMODE=require` is hardcoded in the workflow.

Manual run: **Actions → Daily scraper → Run workflow**.

---

## Architecture

### Data Flow
1. Scraper hits `api.ridibooks.com/v2/selections/?section_id=748` (set books on sale) with pagination, then fetches each book's detail page via `curl_cffi`.
2. Regex-extracts `전자책 세트 정가` discount rate from embedded JSON; reverse-calculates `full_price = set_price / (1 - discount_pct/100)`.
3. Upserts into `books` (maintains `all_time_low` via `LEAST()`) and appends to `price_history` only when price changes.

### Schema
- `books`: `book_id` (PK), `title`, `full_price`, `set_price`, `all_time_low`, `discount_pct`, `updated_at`
- `price_history`: `id`, `book_id` (FK), `set_price`, `start_date`, `end_date`, `scraped_at`

### Prisma Notes
- Runtime uses the **driver adapter** pattern (`PrismaNeon` + `@neondatabase/serverless`) for edge compatibility.
- `schema.prisma` has no `url` in the datasource block — `DATABASE_URL` is supplied via `prisma.config.ts` at CLI time.

---

## Tech Stack

- **Frontend:** Next.js 15 (App Router, RSC, edge runtime), recharts, Prisma 6
- **Scraper:** Python 3.11, `curl_cffi` (Chrome TLS fingerprint), `psycopg2`
- **Database:** PostgreSQL (Docker local / Neon serverless prod)
- **Deploy:** Cloudflare Pages (`@cloudflare/next-on-pages`), GitHub Actions

---

## ⚠️ Disclaimer
본 사이트는 리디북스와 관련 없는 제 3자 운영 비영리 사이트입니다.
