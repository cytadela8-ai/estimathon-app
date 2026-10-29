# syntax=docker/dockerfile:1
# Match build/runtime libc and Node ABI for better-sqlite3; pin the multi-platform image index.
FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base
WORKDIR /app

FROM base AS dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && apt-get clean
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack prepare pnpm@10.34.7 --activate

FROM dependencies AS production-dependencies
RUN --mount=type=cache,id=estymathon-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm --config.ignore-scripts=false rebuild better-sqlite3

FROM dependencies AS build
RUN --mount=type=cache,id=estymathon-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/estymator.sqlite
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN install -d -o node -g node -m 0700 /app/data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node --input-type=module -e \
    "const url = 'http://127.0.0.1:' + process.env.PORT + '/api/state'; \
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); \
    if (!response.ok) process.exit(1);"
CMD ["node", "dist/server/index.js"]
