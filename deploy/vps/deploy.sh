#!/usr/bin/env bash
# Deploy the current commit to a fresh Ubuntu VPS:  deploy/vps/deploy.sh <server-ip>
# Installs Docker if missing, copies the code (git archive, no history), creates secrets ON the server
# the first time (kept across deploys), copies AI keys from the local .env, then builds and starts.
set -euo pipefail
IP="$1"; HOST="root@$IP"; DOMAIN="${IP//./-}.sslip.io"
cd "$(dirname "$0")/../.."

ssh -o StrictHostKeyChecking=accept-new "$HOST" 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh'
git archive --format=tar HEAD | ssh "$HOST" 'rm -rf /opt/haqdaar.new && mkdir -p /opt/haqdaar.new && tar -x -C /opt/haqdaar.new \
  && if [ -f /opt/haqdaar/deploy/vps/.env ]; then cp /opt/haqdaar/deploy/vps/.env /opt/haqdaar.new/deploy/vps/.env; fi \
  && rm -rf /opt/haqdaar && mv /opt/haqdaar.new /opt/haqdaar'

# Secrets: generated once on the server. AI keys and models: taken from the local .env on every deploy.
grep -E '^(AI_PROFILE|GROQ_API_KEY|GROQ_LLM_MODEL|GROQ_STT_MODEL|GEMINI_API_KEY|GEMINI_DEMO_API_KEY|GEMINI_MODEL)=' .env \
  | ssh "$HOST" "cd /opt/haqdaar/deploy/vps && touch .env && grep -q '^DB_PASSWORD=' .env || {
      r() { openssl rand -hex 32; }
      openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/jwt.pem 2>/dev/null
      { echo DOMAIN=$DOMAIN; echo DB_PASSWORD=\$(r); echo INTERNAL_SECRET=\$(r); echo PII_ENC_KEY=\$(r); echo PII_HASH_KEY=\$(r)
        echo SEAL_SECRET=\$(r); echo WEBHOOK_SIGNING_SECRET=\$(r); echo NODE_ENV=production; echo LOG_LEVEL=info
        echo DEMO_MODE=1; echo DEMO_PASSWORD=demo1234
        echo JWT_PRIVATE_KEY=\\\"\$(awk 'BEGIN{ORS=\"\\\\\\\\n\"}1' /tmp/jwt.pem)\\\"
        echo JWT_PUBLIC_KEY=\\\"\$(openssl pkey -in /tmp/jwt.pem -pubout | awk 'BEGIN{ORS=\"\\\\\\\\n\"}1')\\\"; } >> .env
      rm /tmp/jwt.pem; }
    grep -vE '^(AI_PROFILE|GROQ_|GEMINI_)' .env > .env.tmp; cat >> .env.tmp; mv .env.tmp .env; chmod 600 .env"

ssh "$HOST" "cd /opt/haqdaar/deploy/vps && docker compose --env-file .env up -d --build && docker compose ps"
echo "Deployed: https://$DOMAIN"
