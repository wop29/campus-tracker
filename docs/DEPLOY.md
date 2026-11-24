# Deploying University Hunter

The app is a Next.js 16 server plus a Supabase project (Postgres, Auth, Storage). You host the Next.js part anywhere that can run Node.js or a Docker image. Supabase stays where it is, or moves with you (see [MIGRATING.md](./MIGRATING.md)).

## What has and has not been verified

| Item | Status |
|---|---|
| Migrations, RLS, triggers, import logic | Tested in an in-memory Postgres (`npm run test:db`, `npm run test:import`) |
| `Dockerfile`, `docker-compose.yml` | **Written and checked statically only** (every COPY source exists, `next.config.ts` has `output: 'standalone'`, the health route exists). **The image has not been built or run** because Docker was not available. Expect to fix small things on first build. |
| Vercel, Fly.io, Render, Railway steps below | Not run. They describe the standard flow for each; check the host's current docs for exact screens and flags. |
| A real Supabase project | Never reached from this environment. |

## Environment variables

| Variable | Needed | When it is read | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | **Build time** (inlined into the bundle) | Project Settings > API. Changing it needs a rebuild. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | **Build time** (inlined into the bundle) | The anon (publishable) key. Safe for browsers because Row Level Security protects the data. |
| `ANTHROPIC_API_KEY` | optional | Runtime, server only | Without it AI features show "not configured". Never give it a `NEXT_PUBLIC_` prefix and never pass it as a Docker build arg. |
| `ANTHROPIC_MODEL` | optional | Runtime, server only | Model override. |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | not used | The app never uses it. Leave it unset. Never put it in client code. |

The important consequence: with Docker, `docker run -e NEXT_PUBLIC_SUPABASE_URL=...` has **no effect** on an image that is already built. Pass them as build args.

## Supabase setup (every host)

1. Create a Supabase project. In the SQL editor run every file in `supabase/migrations/` in numeric order (currently 001 to 018).
2. Authentication > URL Configuration:
   - **Site URL**: your public app URL, for example `https://mba.example.com`.
   - **Redirect URLs**: add `https://mba.example.com/auth/callback` (the sign-up confirmation link returns there). Add `http://localhost:3000/auth/callback` if you also develop locally. Add preview URLs if you use them (Vercel previews need a wildcard entry such as `https://*-yourteam.vercel.app/auth/callback`).
3. Decide whether email confirmation is required (Authentication > Providers > Email). The login page handles both.
4. The private Storage bucket `documents` is created by migration 002.

## Option A: Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset: Next.js, no build settings to change).
2. Add the variables from the table above under Project Settings > Environment Variables. The two `NEXT_PUBLIC_` ones are used at build, so set them before the first deploy and redeploy after any change.
3. Deploy, then do the Supabase Auth URL step above with the Vercel URL.

`output: 'standalone'` in `next.config.ts` does not hurt Vercel deployments, which use their own build output. (Not re-verified here: no Vercel deploy was run.)

## Option B: any Docker host (Fly.io, Render, Railway, a VPS)

### Build and run locally or on a VPS

```bash
cp .env.example .env        # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, optionally ANTHROPIC_API_KEY
docker compose up -d --build
curl http://localhost:3000/api/health   # expect {"ok":true}
```

Or without compose:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \
  -t mba-admissions-os .
docker run -d -p 3000:3000 -e ANTHROPIC_API_KEY="sk-ant-..." mba-admissions-os
```

How the image works: three stages (install, build, run), Next.js standalone output, runs as a non-root user (uid 1001), listens on `0.0.0.0:$PORT` (default 3000), and has a healthcheck on `GET /api/health`. That route is unauthenticated on purpose and returns only `{"ok":true}`.

On a VPS, put a reverse proxy with HTTPS in front (Caddy, nginx or Traefik) and point your domain at it. The app needs HTTPS for the phone install (see below) and for Supabase Auth redirects.

### Managed Docker hosts

For each host the two requirements are the same: build from the `Dockerfile` with the two `NEXT_PUBLIC_` values supplied as **build args**, and set `ANTHROPIC_API_KEY` as a normal runtime secret.

- **Fly.io**: `fly launch` (accept the Dockerfile), then `fly secrets set ANTHROPIC_API_KEY=...`, and deploy with `fly deploy --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=...`. Internal port 3000.
- **Render**: new Web Service from the repo, runtime Docker. Check Render's docs on how environment variables reach `ARG`s during a Docker build; the two public values must be available at build.
- **Railway**: deploy from the repo (Dockerfile is detected). Check Railway's docs on exposing variables as build args; the two public values must be available at build.

Set the health check path to `/api/health` where the host supports one.

## Cloudflare

Not supported or tested by this repo. Next.js on Cloudflare needs a separate adapter (OpenNext for Cloudflare) and a Workers-compatible build, which this project has not been configured or checked for. Use Vercel or Docker instead. Cloudflare in front of a Docker host (DNS and proxy) works the usual way.

## Install on a phone (PWA)

The app ships a web app manifest and icons, so on HTTPS (or localhost) you can use "Add to Home Screen" (iOS Safari: Share > Add to Home Screen; Android Chrome: menu > Install app). It opens full screen like an app.

- There is **no service worker**. This is deliberate: caching API responses could show stale data or leak one user's data to another on a shared device.
- **Offline mode is not supported.** Without a connection the app does not load.
- Icons are generated by `node scripts/make-icons.mjs`; theme colors live in `public/manifest.webmanifest` and `app/layout.tsx`.
- Not tested on a real device in this environment.

## Deployment checklist

- [ ] Supabase project created and all migrations in `supabase/migrations/` run in order
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set **at build time**
- [ ] `ANTHROPIC_API_KEY` set at runtime (optional)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not set anywhere the app can see it
- [ ] Supabase Auth Site URL and Redirect URLs include `<your-url>/auth/callback`
- [ ] HTTPS in front of the app
- [ ] `GET /api/health` returns `{"ok":true}`
- [ ] Create an account, sign in, and confirm the default school list appears
- [ ] Settings > Data backup downloads a file
- [ ] `npm test`, `npm run test:db`, `npm run test:import` and `node scripts/check-queries.mjs` pass on the checkout you deploy
