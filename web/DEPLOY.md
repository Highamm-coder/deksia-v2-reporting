# Deploying the Deksia Console to Vercel

The console is a Next.js 14 app living in the **`web/`** subdirectory of this repo. It reads from
Supabase (project `ykxauddrsnuwkvimkdhw`) and gates every page behind email/password login.

## One-time setup (~5 minutes)

1. **Import the repo** at <https://vercel.com/new> → pick `Highamm-coder/deksia-v2-reporting`.
2. **Set the Root Directory to `web`.** This is the one setting that matters — the app is not at the
   repo root. (Project → Settings → Build & Deployment → Root Directory → `web`.)
   Framework preset auto-detects as **Next.js**; leave build/install commands at their defaults.
3. **Add two Environment Variables** (Project → Settings → Environment Variables), for all
   environments (Production, Preview, Development):

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://ykxauddrsnuwkvimkdhw.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's **anon / publishable** key (Supabase → Project Settings → API Keys) |

   Both are safe to expose to the browser — the anon key only grants what RLS allows, and every
   table/view is behind `authenticated` policies. Do **not** put the service-role key here.
4. **Deploy.** Vercel builds and gives you a `*.vercel.app` URL.

## After first deploy

- **Supabase Auth → URL Configuration:** add your Vercel URL as the **Site URL** (and to
  *Redirect URLs*). Email/password login works without it, but this keeps auth links correct if we
  later add password reset or invites.
- **Log in** with the account created for `matthew@deksia.com` and change the temporary password.
- Adding a teammate: create their user in Supabase → Authentication → Users (or we add a
  domain-gated `/signup` route — ask).

## Local development

`web/.env.local` already holds the two env vars (git-ignored). From `web/`:

```bash
npm install
npm run dev      # http://localhost:3000
```

## What's deployed

- **Overview** (`/`) — pipeline health + goal scoreboard across all clients.
- **Clients** (`/clients`) — the client list.
- **Client detail** (`/clients/[slug]`) — **per-client performance** (KPI strip + per-source
  current-vs-previous-month tables with MoM deltas), goals, and source freshness.

Data refreshes come from the daily sync routine writing to `metrics_daily`; the console always
reads the latest. No rebuild/redeploy is needed when data updates.
