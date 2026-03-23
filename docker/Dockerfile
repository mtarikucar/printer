# ── Base: Node 20 + Python 3 + system libs ──────────────────────────
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python venv (needed by worker for mesh processing)
COPY scripts/requirements.txt scripts/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r scripts/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# ── Deps: install all node dependencies (including devDeps for tsx) ──
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ── Builder: build Next.js standalone output ─────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Pre-download RMBG-1.4 model during build so it's cached in the image
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface
RUN node --input-type=module -e " \
  import { env, AutoModel, AutoProcessor } from '@huggingface/transformers'; \
  env.cacheDir = '/app/.cache/huggingface'; \
  await AutoModel.from_pretrained('briaai/RMBG-1.4', { device: 'cpu' }); \
  await AutoProcessor.from_pretrained('briaai/RMBG-1.4'); \
  console.log('RMBG-1.4 model pre-downloaded to', env.cacheDir); \
"

RUN npm run build

# ── App target: Next.js standalone server ────────────────────────────
FROM base AS app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Fix: onnxruntime-node .so shared libraries missing from standalone trace
COPY --from=builder --chown=nextjs:nodejs \
  /app/node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/ \
  ./node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/

# HuggingFace model cache (pre-downloaded in builder stage)
COPY --from=builder --chown=nextjs:nodejs /app/.cache/huggingface ./.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_DIR=/app/uploads

VOLUME ["/app/uploads"]

CMD ["node", "server.js"]

# ── Worker target: BullMQ workers + Python mesh processing ───────────
FROM base AS worker
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs

RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

ENV HOME=/home/nextjs

# Full node_modules (tsx is in devDeps, needed to run workers/start.ts)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./
COPY --chown=nextjs:nodejs tsconfig.json ./
COPY --chown=nextjs:nodejs workers ./workers
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs drizzle.config.ts ./

USER nextjs

ENV UPLOAD_DIR=/app/uploads

VOLUME ["/app/uploads"]

CMD ["npx", "tsx", "workers/start.ts"]
