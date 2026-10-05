#!/usr/bin/env bash
# Dump do Mongo + tar dos uploads. Agende via cron (ex.: 0 3 * * *).
set -euo pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
OUT_DIR=/var/backups/nx360
mkdir -p "$OUT_DIR"

# Mongo
docker exec nx360_mongo sh -c \
  'mongodump --username=$MONGO_INITDB_ROOT_USERNAME --password=$MONGO_INITDB_ROOT_PASSWORD \
             --authenticationDatabase=admin --archive --gzip' > "$OUT_DIR/mongo_$STAMP.gz"

# Uploads (planta baixa, logos)
docker run --rm -v nx360_uploads:/data -v "$OUT_DIR":/out alpine \
  tar czf "/out/uploads_$STAMP.tar.gz" -C /data .

# Rotação simples: mantém 14 dias
find "$OUT_DIR" -type f -mtime +14 -delete
echo "Backup OK em $OUT_DIR"
