# Multi-stage build: Node.js + Python
FROM node:20-slim AS base

# Install Python for mesh processing
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY scripts/requirements.txt scripts/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r scripts/requirements.txt

ENV PATH="/opt/venv/bin:$PATH"

# Node dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create uploads directory
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=deps /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_DIR=/app/uploads

VOLUME ["/app/uploads"]

CMD ["node", "server.js"]
