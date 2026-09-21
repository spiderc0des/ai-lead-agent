# Single Node service: UI, API and the agent worker in one process.
#
# NOT a `standalone` build. The Agent SDK spawns the Claude Code CLI from
# node_modules and resolves a platform-specific binary at runtime, which the
# standalone tracer does not follow. Shipping full node_modules is the reliable
# option here.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public vars are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV AGENT_CWD=/app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# The agent's skills. Without this the run aborts at startup with
# "Skills failed to load" — which is the intended behaviour, but the fix is here.
COPY --from=builder /app/.claude ./.claude

EXPOSE 3000
CMD ["npm", "run", "start"]
