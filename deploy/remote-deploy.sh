#!/usr/bin/env bash
# =============================================================================
# t3leem.my — server-side deploy (Ubuntu 22.04+). Run as root by deploy/deploy.sh.
#   bash remote-deploy.sh <release-id> <public-host>
#
# Idempotent: the first run provisions the server (Node 22, PostgreSQL, Redis, Nginx,
# firewall, DB roles, secrets, systemd units); every run builds a new release, migrates
# the DB, switches traffic only after health checks pass, and rolls back otherwise.
# Secrets are generated ON the server and never leave it.
# =============================================================================
set -euo pipefail

RELEASE_ID="${1:?release id required}"
PUBLIC_HOST="${2:?public host (IP or domain) required}"
APP_USER=t3leem
APP_DIR=/opt/t3leem
SHARED="$APP_DIR/shared"
RELEASE="$APP_DIR/releases/$RELEASE_ID"
ARCHIVE="/tmp/t3leem-$RELEASE_ID.tar.gz"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------- system
log "System packages"
if ! command -v nginx >/dev/null || ! command -v psql >/dev/null || ! command -v redis-server >/dev/null; then
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg git nginx postgresql postgresql-contrib redis-server ufw openssl build-essential
fi
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

# Small VPS: `next build` needs ~1.5 GB. Add swap once if RAM is tight.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ] && ! swapon --show | grep -q swapfile; then
  log "Adding 2G swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

systemctl enable --now postgresql redis-server nginx >/dev/null

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/releases" "$SHARED/storage" "$SHARED/keys"

# ----------------------------------------------------------------------------- release
log "Unpacking release $RELEASE_ID"
mkdir -p "$RELEASE"
tar -xzf "$ARCHIVE" -C "$RELEASE"
rm -f "$ARCHIVE"

# ----------------------------------------------------------------------------- database
if [ ! -f "$SHARED/db.env" ]; then
  log "Generating database role passwords (first run)"
  umask 077
  printf 'OWNER_PW=%s\nAPP_PW=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$SHARED/db.env"
fi
# shellcheck disable=SC1091
source "$SHARED/db.env"

log "Database roles, databases and privileges"
PG_NUM=$(sudo -u postgres psql -tAc 'SHOW server_version_num')
ROLES_SQL="$RELEASE/scripts/db/01_roles_and_databases.sql"
if [ "$PG_NUM" -lt 170000 ]; then
  # The builtin locale provider needs PostgreSQL 17+; fall back to a C.UTF-8 libc locale.
  sed -i "s/LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8''/LOCALE ''C.UTF-8''/" "$ROLES_SQL"
fi
# Run from /tmp: the postgres user can't read root-owned release dirs.
cp "$ROLES_SQL" /tmp/t3leem-01.sql && cp "$RELEASE/scripts/db/02_database_privileges.sql" /tmp/t3leem-02.sql
chmod 644 /tmp/t3leem-0*.sql
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -f /tmp/t3leem-01.sql
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d t3leem -f /tmp/t3leem-02.sql
rm -f /tmp/t3leem-0*.sql

# ----------------------------------------------------------------------------- secrets / env
if [ ! -f "$SHARED/keys/jwt-private.pem" ]; then
  log "Generating RS256 JWT key pair (first run)"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SHARED/keys/jwt-private.pem" 2>/dev/null
  openssl pkey -in "$SHARED/keys/jwt-private.pem" -pubout -out "$SHARED/keys/jwt-public.pem"
fi

# HTTPS only exists once a domain + certificate are set up; until then cookies must not be Secure.
case "$PUBLIC_HOST" in
  *[!0-9.]*) SCHEME=https; COOKIE_SECURE=true ;;
  *)         SCHEME=http;  COOKIE_SECURE=false ;;
esac
[ -f /etc/letsencrypt/live/"$PUBLIC_HOST"/fullchain.pem ] || { SCHEME=http; COOKIE_SECURE=false; }

if [ ! -f "$SHARED/api.env" ]; then
  log "Writing API environment (first run — secrets generated here, never leave the server)"
  umask 077
  cat > "$SHARED/api.env" <<EOF
NODE_ENV=production
# staging: sandbox payment gateway (a real gateway needs merchant credentials).
APP_ENV=staging
PORT=3000
LOG_LEVEL=info
# Quoted: the URL contains "&", which bash would treat as "run in background" when sourced.
DATABASE_URL="postgresql://t3leem_app:${APP_PW}@127.0.0.1:5432/t3leem?schema=public&connection_limit=10"
DIRECT_DATABASE_URL="postgresql://t3leem_owner:${OWNER_PW}@127.0.0.1:5432/t3leem?schema=public"
REDIS_URL=redis://127.0.0.1:6379
BASE_DOMAIN=t3leem.my
JWT_PUBLIC_KEY_BASE64=$(base64 -w0 "$SHARED/keys/jwt-public.pem")
JWT_PRIVATE_KEY_PATH=$SHARED/keys/jwt-private.pem
JWT_ISSUER=t3leem.my
JWT_AUDIENCE=t3leem.my/api
FIELD_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)
MEDIA_SIGNING_SECRET=$(openssl rand -hex 32)
STORAGE_DIR=$SHARED/storage
MAX_VIDEO_MB=1024
PUBLIC_WEB_URL=${SCHEME}://${PUBLIC_HOST}
VAT_RATE_PERCENT=15
PAYMENT_GATEWAY=sandbox
EOF
fi
# The public URL can change (IP -> domain, http -> https) without regenerating secrets.
sed -i "s#^PUBLIC_WEB_URL=.*#PUBLIC_WEB_URL=${SCHEME}://${PUBLIC_HOST}#" "$SHARED/api.env"

umask 077
cat > "$SHARED/web.env" <<EOF
NODE_ENV=production
PORT=3001
HOSTNAME=127.0.0.1
API_URL=http://127.0.0.1:3000
PUBLIC_WEB_URL=${SCHEME}://${PUBLIC_HOST}
PLATFORM_HOSTS=${PUBLIC_HOST},localhost,127.0.0.1
COOKIE_SECURE=${COOKIE_SECURE}
MAX_VIDEO_MB=1024
NEXT_TELEMETRY_DISABLED=1
EOF
umask 022

# ----------------------------------------------------------------------------- build
log "Installing dependencies and building (API)"
cd "$RELEASE"
npm ci --no-audit --no-fund
npx prisma generate
npm run build

log "Installing dependencies and building (web)"
cd "$RELEASE/web"
npm ci --no-audit --no-fund
set -a; source "$SHARED/web.env"; set +a
npm run build
cd "$RELEASE"

log "Database migrations"
set -a; source "$SHARED/api.env"; set +a
npx prisma migrate deploy
sudo -u postgres psql -X -q -d t3leem -c "REVOKE ALL ON public._prisma_migrations FROM t3leem_app;" || true

if [ ! -f "$SHARED/.seeded" ]; then
  log "Loading demo data (first run only)"
  NODE_ENV=development npx tsx prisma/seed.ts && touch "$SHARED/.seeded"
fi

chown -R "$APP_USER:$APP_USER" "$RELEASE" "$SHARED"
chmod 700 "$SHARED/keys"

# ----------------------------------------------------------------------------- services
log "systemd services"
unit() { # name description workdir envfile exec
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$2
After=network.target postgresql.service redis-server.service

[Service]
User=$APP_USER
WorkingDirectory=$3
EnvironmentFile=$4
ExecStart=$5
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=$SHARED/storage

[Install]
WantedBy=multi-user.target
EOF
}
unit t3leem-api    "t3leem API"          "$APP_DIR/current"     "$SHARED/api.env" "/usr/bin/node dist/server.js"
unit t3leem-worker "t3leem video worker" "$APP_DIR/current"     "$SHARED/api.env" "/usr/bin/node dist/worker.js"
unit t3leem-web    "t3leem web"          "$APP_DIR/current/web" "$SHARED/web.env" "/usr/bin/node node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1"
systemctl daemon-reload

# ----------------------------------------------------------------------------- nginx
log "Nginx"
cat > /etc/nginx/sites-available/t3leem <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 1100m;
    server_tokens off;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;

    # Public REST API (webhooks, certificate verification, integrations).
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_read_timeout 120s;
    }

    # Video uploads: stream straight through (no buffering a 1 GB file on disk first).
    location ~ ^/[a-z0-9-]+/admin-upload/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/t3leem /etc/nginx/sites-enabled/t3leem
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ----------------------------------------------------------------------------- firewall
if ! ufw status | grep -q "Status: active"; then
  log "Firewall (SSH + HTTP/HTTPS only; PostgreSQL/Redis/Node stay private)"
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable
fi

# ----------------------------------------------------------------------------- switch + health
PREVIOUS=$(readlink -f "$APP_DIR/current" 2>/dev/null || true)
log "Switching to release $RELEASE_ID"
ln -sfn "$RELEASE" "$APP_DIR/current"
systemctl enable t3leem-api t3leem-worker t3leem-web >/dev/null
systemctl restart t3leem-api t3leem-worker t3leem-web

healthy=false
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null && curl -fsS -o /dev/null http://127.0.0.1:3001/; then healthy=true; break; fi
  sleep 2
done

if [ "$healthy" != true ]; then
  echo "!! Health check failed — rolling back" >&2
  journalctl -u t3leem-api -u t3leem-web -n 40 --no-pager >&2 || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$APP_DIR/current"
    systemctl restart t3leem-api t3leem-worker t3leem-web
  fi
  exit 1
fi

# Keep the last 3 releases for quick rollback.
ls -1dt "$APP_DIR"/releases/* | tail -n +4 | xargs -r rm -rf

log "Deployed release $RELEASE_ID → ${SCHEME}://${PUBLIC_HOST}"
curl -s -o /dev/null -w "public check: HTTP %{http_code}\n" "http://127.0.0.1/"
