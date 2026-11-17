# MBA Admissions OS: multi-stage build using Next.js standalone output.
#
# !! NEXT_PUBLIC_* values are INLINED INTO THE JAVASCRIPT BUNDLE AT BUILD TIME. !!
# Passing them with `docker run -e` or compose `environment:` does NOT change a built image.
# Build with:  docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t mba-os .
# Changing the Supabase project means rebuilding the image.
# ANTHROPIC_API_KEY (server only) is a RUNTIME variable: never pass it as a build arg.
#
# NOTE: this file was checked statically only (paths, config). It has not been built or run by the author.

ARG NODE_VERSION=22

# ---- 1. deps: install node_modules from the lockfile (includes dev deps, needed by the build) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. build: next build with output: 'standalone' ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. run: only the standalone server, static assets and public files; non-root ----
FROM node:${NODE_VERSION}-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
