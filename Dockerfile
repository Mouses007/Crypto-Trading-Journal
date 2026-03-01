# ── Build-Stage ──────────────────────────────────────────────
FROM node:20-slim AS builder

# Build-Tools für native Module (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ── Production-Stage ────────────────────────────────────────
FROM node:20-slim

# Schriftarten für Share-Card SVG-Overlay (sharp braucht System-Fonts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY server/ ./server/
COPY src/assets/icon.png ./src/assets/icon.png
COPY index.mjs ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV CTJ_HOST=0.0.0.0
ENV CTJ_PORT=8080
EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "index.mjs"]
