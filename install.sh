#!/bin/sh
# HRIS self-hosted installer.
#
#   Install (Community, free):
#     curl -fsSL https://LICENSE-WEBSITE/install.sh | sh
#   Upgrade to Pro (command generated in HRIS > Lisensi & Paket after activating a license):
#     curl -fsSL https://LICENSE-WEBSITE/install.sh | sh -s -- --upgrade-code XXXX-XXXX-XXXX-XXXX
#   From a source checkout (builds the image locally):
#     sh install.sh --build .
#
# Running again in the same directory keeps .env (and every key) and only pulls and restarts.
# Nothing is published to the internet: the app binds to 127.0.0.1 unless --bind is given.
set -eu

# Filled in when the license website serves this script; unreplaced values count as empty.
RAW_BASE="${HRIS_RAW_BASE:-__HRIS_RAW_BASE__}"
DEFAULT_IMAGE="${HRIS_COMMUNITY_IMAGE:-__HRIS_COMMUNITY_IMAGE__}"
LICENSE_SERVER="${HRIS_LICENSE_SERVER:-__HRIS_LICENSE_SERVER__}"
case "$RAW_BASE" in __HRIS_*) RAW_BASE="" ;; esac
case "$DEFAULT_IMAGE" in __HRIS_*) DEFAULT_IMAGE="" ;; esac
case "$LICENSE_SERVER" in __HRIS_*) LICENSE_SERVER="" ;; esac

DIR=""
IMAGE=""
BUILD_SRC=""
SITE_URL=""
PORT="3000"
BIND="127.0.0.1"
ADMIN_EMAIL=""
TRUST_PROXY="0"
UPGRADE_CODE=""
LIFECYCLE="no"
ASSUME_YES="no"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: install.sh [options]
  --dir DIR                 Install directory (default ./hris, or the current directory when it holds an installation)
  --image IMAGE             HRIS image tag or digest (default: the published Community image)
  --build SRC_DIR           Build the image from an HRIS source checkout instead of pulling
  --url URL                 Public URL users open (default http://localhost:PORT); must match your HTTPS domain
  --port PORT               Host port (default 3000)
  --bind ADDRESS            Host address to bind (default 127.0.0.1; put a TLS reverse proxy in front)
  --trust-proxy N           Number of reverse proxies in front of the app (default 0)
  --admin-email EMAIL       First superadmin email (default admin@hris.local)
  --license-server URL      License website (HTTPS) used for activation and Pro upgrades
  --upgrade-code CODE       Switch an existing installation to HRIS Pro (code from Lisensi & Paket, valid 15 minutes)
  --lifecycle               Pro, Linux only: optional agent for automatic backup/update/rollback (mounts the Docker socket)
  --yes                     Do not ask questions
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --build) BUILD_SRC="$2"; shift 2 ;;
    --url) SITE_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --trust-proxy) TRUST_PROXY="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --license-server) LICENSE_SERVER="$2"; shift 2 ;;
    --upgrade-code) UPGRADE_CODE="$2"; shift 2 ;;
    --lifecycle) LIFECYCLE="yes"; shift ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "Unknown option: $1" ;;
  esac
done

case "$PORT" in ''|*[!0-9]*) fail "--port must be a number" ;; esac
case "$TRUST_PROXY" in ''|*[!0-9]*) fail "--trust-proxy must be a number" ;; esac
valid_image() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9./:_@-]{0,254}$'; }
valid_https() { printf '%s' "$1" | grep -Eq '^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/?$'; }
if [ -n "$IMAGE" ] && ! valid_image "$IMAGE"; then fail "--image contains invalid characters."; fi
if [ -n "$LICENSE_SERVER" ]; then
  valid_https "$LICENSE_SERVER" || fail "--license-server must be an HTTPS origin (plain HTTP only for localhost)."
  LICENSE_SERVER=${LICENSE_SERVER%/}
fi
if [ -n "$UPGRADE_CODE" ]; then
  printf '%s' "$UPGRADE_CODE" | grep -Eq '^[A-Za-z0-9-]{16,24}$' || fail "Invalid --upgrade-code."
fi

ask() { # ask VAR "Question" default
  eval "current=\${$1}"
  if [ -n "$current" ] || [ "$ASSUME_YES" = "yes" ] || [ ! -r /dev/tty ]; then
    [ -n "$current" ] || eval "$1=\$3"
    return
  fi
  printf '%s [%s]: ' "$2" "$3" > /dev/tty
  read -r answer < /dev/tty || answer=""
  eval "$1=\${answer:-\$3}"
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; fi
}
rand_password() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24; }
get_env() { sed -n "s/^$1=//p" .env | tail -n 1; }
set_env() { # set_env KEY VALUE; values are validated by the caller (no newline or backslash)
  umask 077
  awk -v k="$1" -v v="$2" 'index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' .env > .env.tmp
  chmod 600 .env.tmp
  mv .env.tmp .env
}

# --- Preconditions -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "Docker is required (Docker Engine 24+ or Docker Desktop)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose)."
compose_version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
compose_major=$(printf '%s' "$compose_version" | cut -d. -f1)
compose_minor=$(printf '%s' "$compose_version" | cut -d. -f2)
if [ "${compose_major:-0}" -lt 2 ] || { [ "${compose_major:-0}" -eq 2 ] && [ "${compose_minor:-0}" -lt 24 ]; }; then
  fail "Docker Compose 2.24+ is required (found $compose_version)."
fi
docker info >/dev/null 2>&1 || fail "Cannot reach the Docker daemon. Start Docker or add this user to the docker group."
command -v curl >/dev/null 2>&1 || fail "curl is required."

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)
if [ -z "$DIR" ]; then
  # The upgrade command is run inside the installation folder.
  if [ -f ./.env ] && [ -f ./compose.image.yml ]; then DIR="."; else DIR="./hris"; fi
fi
if [ -n "$UPGRADE_CODE" ] && [ ! -f "$DIR/.env" ]; then
  fail "No installation found in $DIR. Run the upgrade command inside the HRIS installation folder or pass --dir."
fi
mkdir -p "$DIR"
chmod 700 "$DIR"
DIR=$(CDPATH= cd -- "$DIR" && pwd)

fetch() { # fetch FILE (always refreshed so fixes to the compose files arrive with updates)
  if [ -f "$SCRIPT_DIR/$1" ] && [ "$SCRIPT_DIR" != "$DIR" ]; then cp "$SCRIPT_DIR/$1" "$DIR/$1"; return; fi
  if [ -z "$RAW_BASE" ]; then
    [ -f "$DIR/$1" ] && return
    fail "$1 not found next to install.sh. Set HRIS_RAW_BASE to the HTTPS URL that serves it."
  fi
  case "$RAW_BASE" in https://*|http://localhost*|http://127.0.0.1*) ;; *) fail "HRIS_RAW_BASE must use HTTPS." ;; esac
  curl -fsSL "$RAW_BASE/$1" -o "$DIR/$1.tmp" && mv "$DIR/$1.tmp" "$DIR/$1"
}

fetch compose.image.yml
if [ "$LIFECYCLE" = "yes" ]; then fetch compose.lifecycle.yml; fi

cd "$DIR"
NEW_INSTALL="no"

if [ -f .env ]; then
  say "Existing installation found in $DIR: .env and every key are kept."
  # Older layouts used a separate Pro overlay; licensing now lives in the app.
  case "$(get_env COMPOSE_FILE)" in *compose.pro.yml*)
    if [ -f compose.lifecycle.yml ] && [ -n "$(get_env HRIS_AGENT_IMAGE)" ]; then set_env COMPOSE_FILE "compose.image.yml:compose.lifecycle.yml"
    else set_env COMPOSE_FILE "compose.image.yml"; fi ;;
  esac
  if [ -n "$LICENSE_SERVER" ] && [ -z "$(get_env HRIS_LICENSE_SERVER)" ]; then set_env HRIS_LICENSE_SERVER "$LICENSE_SERVER"; fi
  if [ -n "$IMAGE" ]; then set_env HRIS_IMAGE "$IMAGE"; fi
else
  NEW_INSTALL="yes"
  if [ -n "$BUILD_SRC" ]; then
    [ -f "$BUILD_SRC/Dockerfile" ] || fail "--build expects an HRIS source directory containing Dockerfile."
    IMAGE="hris-local:$(date +%Y%m%d%H%M%S)"
  fi
  IMAGE="${IMAGE:-$DEFAULT_IMAGE}"
  [ -n "$IMAGE" ] || fail "Provide --image (published HRIS image) or --build SRC_DIR."
  ask SITE_URL "Public URL" "http://localhost:$PORT"
  ask ADMIN_EMAIL "First superadmin email" "admin@hris.local"
  case "$SITE_URL" in
    https://*|http://localhost*|http://127.0.0.1*) ;;
    *) fail "--url must be HTTPS (plain HTTP only for localhost)." ;;
  esac
  printf '%s' "$SITE_URL" | grep -Eq '^[A-Za-z0-9:/._-]+$' || fail "Invalid --url."
  printf '%s' "$ADMIN_EMAIL" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' || fail "Invalid admin email."

  umask 077
  {
    say "# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep private; back up with the database."
    say "# Changing ENCRYPTION_KEY or STORAGE_SIGNING_SECRET later makes stored data or links unreadable."
    say "COMPOSE_PROJECT_NAME=hris"
    say "COMPOSE_FILE=compose.image.yml"
    say "HRIS_EDITION=community"
    say "HRIS_IMAGE=$IMAGE"
    say "HRIS_INSTALL_DIR=$DIR"
    say "BIND_ADDRESS=$BIND"
    say "APP_PORT=$PORT"
    say "NEXTAUTH_URL=$SITE_URL"
    say "TRUST_PROXY=$TRUST_PROXY"
    say "HRIS_LICENSE_SERVER=$LICENSE_SERVER"
    say "POSTGRES_ADMIN_PASSWORD=$(rand_hex 32)"
    say "HRIS_DB_NAME=hris"
    say "HRIS_DB_USER=hris"
    say "HRIS_DB_PASSWORD=$(rand_hex 32)"
    say "AUTH_SECRET=$(rand_hex 32)"
    say "ENCRYPTION_KEY=$(rand_hex 32)"
    say "STORAGE_SIGNING_SECRET=$(rand_hex 32)"
    say "CRON_SECRET=$(rand_hex 32)"
  } > .env
  chmod 600 .env
  say "Created $DIR/.env with random secrets (mode 600)."
fi

# --- Upgrade to Pro ------------------------------------------------------------
PREVIOUS_IMAGE=""
if [ -n "$UPGRADE_CODE" ]; then
  SERVER="${LICENSE_SERVER:-$(get_env HRIS_LICENSE_SERVER)}"
  [ -n "$SERVER" ] || fail "License server unknown. Pass --license-server https://LICENSE-WEBSITE."
  valid_https "$SERVER" || fail "HRIS_LICENSE_SERVER must be HTTPS."
  SERVER=${SERVER%/}
  say "Redeeming the upgrade code at $SERVER ..."
  umask 077
  answer_file=$(mktemp)
  trap 'rm -f "$answer_file"' EXIT
  status=$(curl -sS --proto '=https,http' --max-redirs 0 -o "$answer_file" -w '%{http_code}' \
    -X POST -H 'content-type: application/json' --data "{\"code\":\"$UPGRADE_CODE\"}" \
    "$SERVER/api/licenses/upgrade?format=env") || fail "Cannot reach the license server."
  if [ "$status" != "200" ]; then
    sed -n 's/.*"error":"\([^"]*\)".*/\1/p' "$answer_file" >&2
    echo >&2
    fail "Upgrade code rejected (HTTP $status). Create a new command in HRIS > Lisensi & Paket."
  fi
  value() { sed -n "s/^$1=//p" "$answer_file" | head -n 1; }
  REGISTRY=$(value REGISTRY); REG_USER=$(value REGISTRY_USERNAME); REG_PASS=$(value REGISTRY_PASSWORD)
  PRO_IMAGE=$(value HRIS_PRO_IMAGE); AGENT_IMAGE=$(value HRIS_AGENT_IMAGE); LICENSE_PUB=$(value LICENSE_PUBLIC_KEY_PEM_B64)
  rm -f "$answer_file"
  printf '%s' "$REGISTRY" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]{2,5})?$' || fail "License server returned an invalid registry."
  printf '%s' "$REG_USER" | grep -Eq '^inst_[A-Za-z0-9_]+$' || fail "License server returned an invalid username."
  printf '%s' "$REG_PASS" | grep -Eq '^[A-Za-z0-9_-]{20,200}$' || fail "License server returned an invalid credential."
  case "$PRO_IMAGE" in "$REGISTRY"/*) valid_image "$PRO_IMAGE" || fail "Invalid Pro image." ;; *) fail "Pro image is not in the private registry." ;; esac
  if [ -n "$AGENT_IMAGE" ]; then case "$AGENT_IMAGE" in "$REGISTRY"/*) valid_image "$AGENT_IMAGE" || AGENT_IMAGE="" ;; *) AGENT_IMAGE="" ;; esac; fi
  printf '%s' "$LICENSE_PUB" | grep -Eq '^[A-Za-z0-9+/=]*$' || LICENSE_PUB=""

  # Per-installation pull credential; pulls only work while the license is active.
  printf '%s' "$REG_PASS" | docker login "$REGISTRY" --username "$REG_USER" --password-stdin >/dev/null \
    || fail "docker login to $REGISTRY failed."
  unset REG_PASS
  PREVIOUS_IMAGE=$(get_env HRIS_IMAGE)
  set_env HRIS_PREVIOUS_IMAGE "$PREVIOUS_IMAGE"
  set_env HRIS_IMAGE "$PRO_IMAGE"
  set_env HRIS_EDITION pro
  set_env HRIS_LICENSE_SERVER "$SERVER"
  [ -z "$AGENT_IMAGE" ] || set_env HRIS_AGENT_IMAGE "$AGENT_IMAGE"
  [ -z "$LICENSE_PUB" ] || set_env LICENSE_PUBLIC_KEY_PEM_B64 "$LICENSE_PUB"
  say "Registry login saved for this installation ($REG_USER)."
fi

# --- Optional lifecycle agent (Pro) ------------------------------------------
if [ "$LIFECYCLE" = "yes" ]; then
  [ "$(get_env HRIS_EDITION)" = "pro" ] || fail "--lifecycle needs HRIS Pro. Upgrade first with --upgrade-code."
  [ -n "$(get_env HRIS_AGENT_IMAGE)" ] || fail "No agent image is published for this license server."
  [ -n "$(get_env LICENSE_PUBLIC_KEY_PEM_B64)" ] || fail "LICENSE_PUBLIC_KEY_PEM_B64 is missing; run the upgrade command again."
  [ -S /var/run/docker.sock ] || fail "--lifecycle needs /var/run/docker.sock on a Linux host."
  set_env COMPOSE_FILE "compose.image.yml:compose.lifecycle.yml"
  set_env DOCKER_GID "$(stat -c %g /var/run/docker.sock)"
  [ -n "$(get_env HRIS_AGENT_TOKEN)" ] || set_env HRIS_AGENT_TOKEN "$(rand_hex 32)"
  [ -n "$(get_env AUTO_BACKUP_INTERVAL_HOURS)" ] || set_env AUTO_BACKUP_INTERVAL_HOURS 24
  [ -n "$(get_env AUTO_UPDATE_INTERVAL_HOURS)" ] || set_env AUTO_UPDATE_INTERVAL_HOURS 0
  mkdir -p backups
  chmod 700 backups
  # The agent runs as uid 1001; only its backup folder is writable for it.
  chown 1001:1001 backups 2>/dev/null || say "Run: sudo chown 1001:1001 $DIR/backups  (agent backups need it)"
fi

# --- Pull and start ------------------------------------------------------------
if [ -n "$BUILD_SRC" ]; then
  [ -f "$BUILD_SRC/Dockerfile" ] || fail "--build expects an HRIS source directory containing Dockerfile."
  IMAGE=$(get_env HRIS_IMAGE)
  say "Building $IMAGE from $BUILD_SRC ..."
  docker build -t "$IMAGE" "$BUILD_SRC"
  docker compose pull --ignore-pull-failures postgres
elif ! docker compose pull; then
  if [ -n "$PREVIOUS_IMAGE" ]; then set_env HRIS_IMAGE "$PREVIOUS_IMAGE"; set_env HRIS_EDITION community; fi
  fail "Pull failed; nothing was changed. Check that the license is active, then create a new upgrade command."
fi
docker compose up -d

say "Waiting for HRIS to become healthy ..."
tries=0
until docker compose exec -T app wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    if [ -n "$PREVIOUS_IMAGE" ]; then
      say "HRIS Pro did not become healthy; switching back to $PREVIOUS_IMAGE ..."
      set_env HRIS_IMAGE "$PREVIOUS_IMAGE"
      set_env HRIS_EDITION community
      docker compose up -d app
    fi
    fail "HRIS did not become healthy. Check: docker compose logs app"
  fi
  sleep 3
done

SITE_URL=$(get_env NEXTAUTH_URL)
if [ "$NEW_INSTALL" = "yes" ]; then
  SEED_ADMIN_EMAIL="$ADMIN_EMAIL"
  SEED_ADMIN_PASSWORD="$(rand_password)"
  export SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  # Passed by name so the password never appears in the process list; it is not written to disk.
  docker compose exec -T -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD app node db-seed.cjs > /dev/null
  say ""
  say "=============================================================="
  say " HRIS is running at $SITE_URL"
  say " Administrator login: $SITE_URL/auth/admin"
  say "   email:    $SEED_ADMIN_EMAIL"
  say "   password: $SEED_ADMIN_PASSWORD"
  say " This password is shown once. Sign in and change it now."
  say " Upgrade to Pro any time from Lisensi & Paket."
  say "=============================================================="
  unset SEED_ADMIN_PASSWORD
elif [ -n "$UPGRADE_CODE" ]; then
  say ""
  say "=============================================================="
  say " HRIS Pro is running at $SITE_URL"
  say " Data, accounts and keys are unchanged. Reload Lisensi & Paket:"
  say " the edition now shows Pro and the licensed features are active."
  say "=============================================================="
else
  say "HRIS updated and running. Existing accounts and data were not changed."
fi
say "Next: put an HTTPS reverse proxy in front (set --url to that domain and --trust-proxy 1),"
say "      and back up $DIR/.env together with the database and uploads, e.g.:"
say "      docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris-\$(date +%F).dump"
