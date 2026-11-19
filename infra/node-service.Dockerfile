# syntax=docker/dockerfile:1.7
# Shared image for the Node realtime services. SERVICE picks the workspace package; EXTERNALS lists the
# node_modules packages kept out of the esbuild bundle (native addons / files resolved from disk).
FROM node:24.18.0-trixie-slim AS build
ARG SERVICE
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages packages
COPY services/feed-simulator/package.json services/feed-simulator/package.json
COPY services/tick-aggregator/package.json services/tick-aggregator/package.json
COPY services/stream-gateway/package.json services/stream-gateway/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@arth/${SERVICE}..."
COPY services/${SERVICE} services/${SERVICE}
COPY infra/scripts/copy-externals.mjs infra-copy-externals.mjs
RUN pnpm --filter "@arth/${SERVICE}..." run build
ARG EXTERNALS=""
RUN mkdir -p /out/node_modules && cp services/${SERVICE}/dist/main.js /out/main.js \
 && node infra-copy-externals.mjs node_modules /out/node_modules $EXTERNALS \
 && find /out/node_modules -name "uws_*.node" ! -name "uws_linux_x64_*" -delete \
 && echo '{"type":"module"}' > /out/package.json

FROM node:24.18.0-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
CMD ["node", "--enable-source-maps", "main.js"]
