#!/bin/bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker/docker-compose.production.yml"
BACKUP_DIR="$PROJECT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_predeploy_${TIMESTAMP}.sql"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

cd "$PROJECT_DIR"

# ─── 1. Pre-deploy DB Backup ─────────────────────────────────────────
log "Veritabanı yedeği alınıyor..."
if docker ps --format '{{.Names}}' | grep -q printer_postgres; then
    docker exec printer_postgres pg_dump -U printer -d printer > "$BACKUP_FILE" 2>/dev/null && \
        log "Yedek alındı: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))" || \
        warn "Yedek alınamadı, devam ediliyor..."
else
    warn "Postgres container çalışmıyor, yedek atlanıyor."
fi

# ─── 2. Build with Docker cache ──────────────────────────────────────
log "Docker image'lar build ediliyor (cache aktif)..."

# BuildKit cache mounts in Dockerfile handle node_modules, .next, and model caching
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 \
    docker-compose -f "$COMPOSE_FILE" build \
    --parallel

log "Build tamamlandı."

# ─── 3. Stop old containers (keep DB & Redis running) ────────────────
log "App ve worker yeniden başlatılıyor..."
docker-compose -f "$COMPOSE_FILE" up -d postgres redis

# Wait for postgres & redis to be healthy before proceeding
docker-compose -f "$COMPOSE_FILE" up -d --wait postgres redis 2>/dev/null || true

# ─── 4. Run migration ────────────────────────────────────────────────
log "Veritabanı migration çalıştırılıyor..."
docker-compose -f "$COMPOSE_FILE" run --rm migrate

# ─── 5. Rolling restart: app & worker ────────────────────────────────
log "Servisler güncelleniyor..."
docker-compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate app worker

# ─── 6. Health check ─────────────────────────────────────────────────
log "Sağlık kontrolü yapılıyor..."
RETRIES=15
for i in $(seq 1 $RETRIES); do
    if curl -sf -o /dev/null http://localhost:3005; then
        log "Uygulama çalışıyor! ✓ http://localhost:3005"
        break
    fi
    if [ "$i" -eq "$RETRIES" ]; then
        err "Uygulama $RETRIES deneme sonrası yanıt vermedi!"
    fi
    sleep 2
done

# ─── 7. Cleanup old images and build cache ───────────────────────────
log "Eski image'lar ve build cache temizleniyor..."
docker image prune -f --filter "until=24h" > /dev/null 2>&1 || true
docker builder prune -f --keep-storage=2GB > /dev/null 2>&1 || true

# ─── Done ─────────────────────────────────────────────────────────────
echo ""
log "Deploy tamamlandı! 🚀"
log "  App:    http://localhost:3005"
log "  Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
log "  Zaman:  $(date '+%Y-%m-%d %H:%M:%S')"
