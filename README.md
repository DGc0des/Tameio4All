# Tameio4All

Cash-register closing for any shop: count the till, log expenses and card/delivery income,
get the envelope (Φάκελος) breakdown and a shareable end-of-day summary.

## Develop
    npm install
    npm run dev        # http://localhost:5173 — on a phone use http://<your-Mac-LAN-IP>:5173 (same Wi-Fi)
    npm test           # unit + UI tests
    npm run typecheck
    npm run build      # typecheck + production build into dist/
Requires Node 22.12+ (or 24+).

## Deploy (Vercel, one-time setup)
1. vercel.com → Add New → Project → import the GitHub repo `DGc0des/Tameio4All`.
2. Framework preset: Vite (auto-detected). Build command `npm run build`, output `dist`.
3. No environment variables are needed yet (Supabase arrives in Plan 3; register
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel then).
4. Deploy. Every push to `main` redeploys.

## Database
Supabase (dev project `fstfuhogvsdaiwpfdmep`). Migrations: `supabase/migrations/` (apply in order).
Security tests: `supabase/tests/` — paste a file into the dashboard SQL editor and run; it cleans up
after itself. Before the owner app works: Authentication → Sign In / Providers → allow anonymous sign-ins.
