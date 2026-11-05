# syntax=docker/dockerfile:1
# =============================================================================
# FAV Assist — imagem multi-estágio
#   target "api"  → API Fastify e worker BullMQ (mesmo código, comandos diferentes)
#   target "web"  → PWA estático servido pelo nginx (proxy /api → api)
# =============================================================================
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai-engine/package.json packages/ai-engine/
COPY packages/messaging/package.json packages/messaging/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @fav/api build && pnpm --filter @fav/web build
# Pasta isolada só com dependências de produção da API
RUN pnpm --filter @fav/api deploy --prod --legacy /out \
 && rm -rf /out/dist && cp -r apps/api/dist /out/dist \
 && mkdir -p /out/supabase /out/db \
 && cp -r supabase/migrations /out/supabase/ \
 && cp -r db/local /out/db/

FROM node:22-alpine AS api
ENV NODE_ENV=production FAV_REPO_ROOT=/app
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3333/api/health || exit 1
CMD ["node", "dist/server.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
