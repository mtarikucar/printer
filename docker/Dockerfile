# ── Base: Node 20 + Python 3 + system libs ──────────────────────────
#
# ffmpeg is here for scripts/render_turntable.py, which stitches the customer's
# 360° approval video. The turntable frames are rasterised in pure numpy on
# purpose: pyrender does not build in this image and OSMesa/PyOpenGL are
# deliberately NOT installed.
FROM node:20-slim AS base

# pymeshlab'in FİLTRE EKLENTİLERİ Qt üzerinden yüklenir ve bu üç kütüphaneyi
# ADIYLA ister. Biri eksikse `import pymeshlab` YİNE BAŞARILI olur — eksik olan
# çekirdek değil, eklentilerdir — ama `MeshSet` bütün filtre metotlarını
# KAYBEDER ve her çağrı `AttributeError` verir. Ölçüm (node:20-slim + aşağıdaki
# liste, 2026-09-30): eksik `libOpenGL.so.0`, `libfontconfig.so.1`,
# `libfreetype.so.6`; `meshing_close_holes` ve
# `meshing_decimation_quadric_edge_collapse` yok. Üçü eklendiğinde: eksik
# nesne kalmıyor, su geçirmez OLMAYAN açık kutu onarılıp 8000 mm³ ölçülüyor,
# 20k yüz 2000'e indiriliyor.
#
# BEDELİ SESSİZDİ, çünkü iki çağrı da `except` ile korunuyor:
# `repair_with_pymeshlab` onarılmamış ağı geri verir → hacim ÖLÇÜLEMEZ →
# `no_volume` DfM hatası → su geçirmez olmayan HER yükleme otomatik fiyat
# alamaz, elle teklife düşer (`quote-pricing.ts`: "Hacim ölçülemeyen parça
# fiyatlanamaz"); `decimate_if_needed` de ağı olduğu gibi bırakır → yüz
# tavanının üstündeki parçanın ÖN İZLEMESİ hiç üretilmez.
#
# `libgl1-mesa-glx` (libGL.so.1) bunların yerine GEÇMEZ: `libOpenGL.so.0`
# libglvnd'nin ayrı paketidir (`libopengl0`) ve libgl1'in bağımlılığı değildir.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libgl1-mesa-glx \
    libopengl0 \
    libfontconfig1 \
    libfreetype6 \
    libglib2.0-0 \
    libgomp1 \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python venv (needed by worker for mesh processing)
COPY scripts/requirements.txt scripts/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r scripts/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# EKLENTİ KAPISI — `import pymeshlab` YETMEZ (yukarıdaki apt yorumuna bakın).
# Çekirdek eksik bir Qt eklenti kümesiyle de sorunsuz import edilir; kaybolan
# şey FİLTRE METOTLARIdır ve ikisi de `except` ile korunduğu için üretimde
# sessizce kaybolur. Bu satır, kullanılan iki filtrenin VARLIĞINI imaj
# DERLEMESİNDE sınar: bir gün apt listesinden biri düşerse müşterinin yüklemesi
# değil, DERLEME kırılır.
RUN /opt/venv/bin/python3 -c "import pymeshlab, sys; ms = pymeshlab.MeshSet(); \
missing = [n for n in ('meshing_close_holes', 'meshing_repair_non_manifold_edges', 'meshing_repair_non_manifold_vertices', 'meshing_decimation_quadric_edge_collapse') if not hasattr(ms, n)]; \
sys.exit('pymeshlab filtre eklentileri yuklenmedi (eksik sistem kutuphanesi): ' + ', '.join(missing)) if missing else print('pymeshlab filtreleri hazir')"

# ── Deps: install all node dependencies (including devDeps for tsx) ──
FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ── Model: pre-download RMBG-1.4 (rarely changes, cached separately) ─
FROM base AS model
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface
RUN --mount=type=cache,target=/tmp/hf-cache \
    mkdir -p /app/.cache/huggingface && \
    cp -a /tmp/hf-cache/. /app/.cache/huggingface/ 2>/dev/null || true && \
    for i in 1 2 3; do \
      node --input-type=module -e " \
        import { env, AutoModel, AutoProcessor } from '@huggingface/transformers'; \
        env.cacheDir = '/app/.cache/huggingface'; \
        await AutoModel.from_pretrained('briaai/RMBG-1.4', { device: 'cpu' }); \
        await AutoProcessor.from_pretrained('briaai/RMBG-1.4'); \
        console.log('RMBG-1.4 cached'); \
      " && break || echo "Attempt $i failed, retrying..." && sleep 5; \
    done; \
    cp -a /app/.cache/huggingface/. /tmp/hf-cache/ || true

# ── Model: pre-download DETR (person counter for scene suggestion). Non-fatal:
#    if the download hiccups the build still succeeds and the app downloads it
#    on first use (containers have network); the feature is best-effort anyway. ─
RUN --mount=type=cache,target=/tmp/hf-cache \
    cp -a /tmp/hf-cache/. /app/.cache/huggingface/ 2>/dev/null || true && \
    node --input-type=module -e " \
      import { env, pipeline } from '@huggingface/transformers'; \
      env.cacheDir = '/app/.cache/huggingface'; \
      await pipeline('object-detection', 'Xenova/detr-resnet-50'); \
      console.log('DETR cached'); \
    " || echo "DETR pre-download failed (non-fatal, will fetch at runtime)"; \
    cp -a /app/.cache/huggingface/. /tmp/hf-cache/ || true

# ── Builder: build Next.js standalone output ─────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public (NEXT_PUBLIC_*) tag IDs are inlined into the client bundle by Next.js at
# build time, so they must be present during `npm run build` — the runtime .env is
# too late for client-side code. Passed via --build-arg from CI (GitHub Secrets).
# Defaults to "" so local/CI builds without the arg still work (GTM becomes a no-op).
ARG NEXT_PUBLIC_GTM_ID=""
ENV NEXT_PUBLIC_GTM_ID=${NEXT_PUBLIC_GTM_ID}
# GA4 measurement id — inlined client-side so the direct gtag('config','G-…')
# bootstrap runs even when GTM isn't managing GA4.
ARG NEXT_PUBLIC_GA4_ID=""
ENV NEXT_PUBLIC_GA4_ID=${NEXT_PUBLIC_GA4_ID}
# TikTok Pixel id — inlined client-side so `ttq.load('<id>')` fires the pixel.
# The app loads TikTok directly (not via GTM), so it must be present at build.
ARG NEXT_PUBLIC_TIKTOK_PIXEL_ID=""
ENV NEXT_PUBLIC_TIKTOK_PIXEL_ID=${NEXT_PUBLIC_TIKTOK_PIXEL_ID}
# Sentry: the public DSN is inlined into the client bundle and also flips
# `sentryEnabled` in next.config.ts (so withSentryConfig + source-map upload run).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
# Source maps upload to Sentry during the build; skipped unless SENTRY_AUTH_TOKEN
# is present (see next.config.ts `sourcemaps.disable`). SENTRY_URL targets the org
# region (EU = https://de.sentry.io/).
ARG SENTRY_ORG=""
ENV SENTRY_ORG=${SENTRY_ORG}
ARG SENTRY_PROJECT=""
ENV SENTRY_PROJECT=${SENTRY_PROJECT}
ARG SENTRY_AUTH_TOKEN=""
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ARG SENTRY_URL=""
ENV SENTRY_URL=${SENTRY_URL}
RUN --mount=type=cache,target=/app/.next/cache npm run build

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

# HuggingFace model cache (from separate model stage)
COPY --from=model --chown=nextjs:nodejs /app/.cache/huggingface ./.cache/huggingface
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
# `workers/instrument.ts` imports this from the repo root (Sentry configs live
# there by convention, next to sentry.server/edge.config.ts). Without it the
# worker dies at startup with MODULE_NOT_FOUND and crash-loops forever.
COPY --chown=nextjs:nodejs sentry.worker.config.ts ./
COPY --chown=nextjs:nodejs workers ./workers
# The CAD kernel (OpenCASCADE via cascadio, ~104 MB unpacked) is installed HERE
# and not in `base`, because `base` is shared with the app image and the app
# never reads a STEP file — see scripts/requirements-cad.txt. Copied on its own,
# BEFORE `scripts`, so that editing any python script does not invalidate this
# layer and re-download the wheel. /opt/venv was created as root in `base` and
# `USER nextjs` is still below, so this runs as root, which is what pip needs.
COPY scripts/requirements-cad.txt scripts/requirements-cad.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r scripts/requirements-cad.txt
COPY --chown=nextjs:nodejs scripts ./scripts
# Import guard: process_upload_model.py once imported helpers that a
# process_mesh.py refactor had deleted, and every upload/product-file preview
# failed silently at runtime. A broken import now fails the image build.
#
# step_mesh.py is in the list for a second reason: it is the ONLY importer of
# cascadio, so this line is also the test that the CAD wheel is present and that
# its bundled OCCT libraries still resolve. If the pinned version disappears
# from PyPI or a shared object goes missing, the IMAGE BUILD fails here —
# instead of a customer's STEP upload failing in production.
RUN /opt/venv/bin/python3 -c "import sys; sys.path.insert(0,'scripts'); import process_upload_model, process_mesh, render_turntable, analyze_quote_part, step_mesh"
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs drizzle.config.ts ./
# Migration SQL files — so `docker exec printer_worker npx drizzle-kit migrate`
# can apply pending migrations against the production DB after a deploy.
COPY --chown=nextjs:nodejs drizzle ./drizzle

USER nextjs

ENV UPLOAD_DIR=/app/uploads

VOLUME ["/app/uploads"]

CMD ["npx", "tsx", "workers/start.ts"]
