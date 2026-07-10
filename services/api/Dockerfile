FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --workspace @xtreme/contracts --workspace @xtreme/api --include-workspace-root=false

FROM dependencies AS builder
COPY packages/contracts packages/contracts
COPY services/api services/api
RUN npm run build --workspace @xtreme/contracts \
    && npm run build --workspace @xtreme/api

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --omit=dev --workspace @xtreme/contracts --workspace @xtreme/api --include-workspace-root=false

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 api

COPY --from=production-dependencies --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder --chown=api:nodejs /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder --chown=api:nodejs /app/services/api/dist ./services/api/dist
COPY --from=builder --chown=api:nodejs /app/services/api/package.json ./services/api/package.json

USER api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "services/api/dist/server.js"]
