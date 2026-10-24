#!/usr/bin/env bash
# =============================================================================
# Deploy the committed code to a server (run from the repo root, Git Bash/Linux/macOS):
#   bash deploy/deploy.sh root@187.126.12.45 t3leem.my   # domain: automatic Let's Encrypt HTTPS
#   bash deploy/deploy.sh root@187.126.12.45            # bare IP over HTTP (no domain yet)
#
# Ships `git archive HEAD` — only committed files. .env, keys/, node_modules, storage/ can
# never be uploaded by accident. The (private) GitHub repo is never needed on the server.
# =============================================================================
set -euo pipefail

TARGET="${1:?usage: deploy/deploy.sh user@host [public-host]}"
PUBLIC_HOST="${2:-${TARGET#*@}}"
SSH_OPTS=(-o ServerAliveInterval=30 -o ConnectTimeout=15)
RELEASE_ID="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
ARCHIVE="$(mktemp -d)/t3leem-$RELEASE_ID.tar.gz"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! Uncommitted changes would NOT be deployed. Commit first." >&2
  exit 1
fi

echo "==> Packing $(git rev-parse --short HEAD) as release $RELEASE_ID"
git archive --format=tar.gz -o "$ARCHIVE" HEAD

echo "==> Uploading to $TARGET"
scp "${SSH_OPTS[@]}" "$ARCHIVE" "$TARGET:/tmp/"
rm -f "$ARCHIVE"
# Strip carriage returns: a Windows checkout would otherwise break bash on the server.
tr -d '\r' < deploy/remote-deploy.sh | ssh "${SSH_OPTS[@]}" "$TARGET" "cat > /tmp/remote-deploy.sh"

echo "==> Running remote deploy"
ssh "${SSH_OPTS[@]}" "$TARGET" "bash /tmp/remote-deploy.sh '$RELEASE_ID' '$PUBLIC_HOST' && rm -f /tmp/remote-deploy.sh"
