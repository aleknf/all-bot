# ====================================================
# STAGE 1: Build Frontend (React + Vite)
# ====================================================
FROM node:22-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ====================================================
# STAGE 2: Build Backend (TypeScript + Prisma)
# ====================================================
FROM node:22-alpine AS server-builder
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/prisma ./prisma
RUN npx prisma generate

COPY server/ ./
RUN npm run build

# ====================================================
# STAGE 3: Production Runner
# ====================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL="file:/app/data/allbot.db"
ENV CLIENT_DIST_PATH="/app/client/dist"
ENV NODE_OPTIONS="--max-http-header-size=128000"

# Install openssl for Prisma runtime on Alpine
RUN apk add --no-cache openssl

# Siapkan direktori data persisten untuk SQLite
RUN mkdir -p /app/data

# Salin package.json backend dan install production dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Salin Prisma schema & migration/seed scripts
COPY server/prisma ./prisma
RUN npx prisma generate

# Salin file build dari Stage 1 dan Stage 2
COPY --from=client-builder /app/client/dist /app/client/dist
COPY --from=server-builder /app/server/dist ./dist

EXPOSE 4000

# Entrypoint: Sinkronkan database secara otomatis saat kontainer pertama kali start, lalu jalankan server
CMD sh -c "npx prisma db push && ( [ ! -f /app/data/.seeded ] && npm run prisma:seed && touch /app/data/.seeded || true ) && node --max-http-header-size=128000 dist/index.js"
