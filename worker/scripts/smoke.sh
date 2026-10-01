#!/usr/bin/env bash
# Smoke test for the Twister media worker.
#
#   worker/scripts/smoke.sh remote   # deployed worker on Fly + the API it talks to (read-only, safe in prod)
#   worker/scripts/smoke.sh local    # build the image and run it against a throwaway fake API (needs docker, python3)
#
# remote needs:  API_BASE_URL (incl. /api/v1)  WORKER_SHARED_SECRET (same value as set on Fly/Vercel)
#                optional: FLY_APP (default: worker-moonlit-waterfall-8666), SMOKE_LOG_WAIT_S (default 45)
# It never claims a real job: the signed probe is a heartbeat for a random job id (expect 404/409).
set -u
FLY_APP="${FLY_APP:-worker-moonlit-waterfall-8666}"
FAILS=0
ok()   { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf 'WARN  %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 2; }; }

remote() {
  need curl; need openssl; need fly
  : "${API_BASE_URL:?set API_BASE_URL, e.g. https://api.example.com/api/v1}"
  : "${WORKER_SHARED_SECRET:?set WORKER_SHARED_SECRET (the same value as on Fly and the API)}"
  local base="${API_BASE_URL%/}"
  local origin="${base%/api/v1}"

  # 1. API reachable (health does not touch the database).
  local code
  code=$(curl -s -o /tmp/smoke-health.$$ -w '%{http_code}' --max-time 15 "$origin/api/health/")
  if [ "$code" = 200 ] && grep -q '"ok"' /tmp/smoke-health.$$; then ok "API health ($origin/api/health/)"; else bad "API health returned HTTP $code"; fi
  rm -f /tmp/smoke-health.$$

  # 2. Signed request accepted: wrong secret/clock/legacy cut-over shows up here as 403; unset secret as 503.
  local ts body sig job
  ts=$(date +%s); body='{}'
  job=$(python3 -c 'import uuid;print(uuid.uuid4())' 2>/dev/null || echo 00000000-0000-4000-8000-000000000000)
  sig=$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$WORKER_SHARED_SECRET" -hex | sed 's/^.* //')
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
    -H 'Content-Type: application/json' -H "X-Worker-Timestamp: $ts" -H "X-Worker-Signature: sha256=$sig" \
    --data "$body" "$base/internal/media/jobs/$job/heartbeat/")
  case "$code" in
    404|409|410) ok "signature accepted by the API (heartbeat for an unknown job answered $code)";;
    403) bad "API rejected the signature (HTTP 403): secret mismatch, clock skew > 300 s, or API_BASE_URL points elsewhere";;
    503) bad "API has no WORKER_SHARED_SECRET configured (HTTP 503)";;
    *)   bad "unexpected HTTP $code from the signed probe";;
  esac

  # 3. Fly machine state.
  local status
  status=$(fly status -a "$FLY_APP" --json 2>/dev/null) || { bad "fly status failed (logged in? right app: $FLY_APP?)"; return; }
  local started total
  started=$(printf '%s' "$status" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(sum(1 for m in d.get("Machines",[]) if m.get("state")=="started"))' 2>/dev/null || echo 0)
  total=$(printf '%s' "$status" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d.get("Machines",[])))' 2>/dev/null || echo 0)
  if [ "${started:-0}" -ge 1 ]; then ok "Fly: $started/$total machine(s) started"; else bad "Fly: no machine is started ($total total); see fly status -a $FLY_APP"; fi

  # 4. Recent logs: it is polling, and not failing.
  local logs
  logs=$(timeout "${SMOKE_LOG_WAIT_S:-45}" fly logs -a "$FLY_APP" --no-tail 2>/dev/null | tail -200)
  [ -n "$logs" ] || { warn "no log lines returned (fresh deploy? try again in a minute)"; return; }
  if printf '%s' "$logs" | grep -q -E 'HTTP 403|HTTP 503|ConfigError'; then bad "logs show auth/config errors: $(printf '%s' "$logs" | grep -E 'HTTP 403|HTTP 503|ConfigError' | tail -1 | cut -c1-200)"; else ok "no 403/503/ConfigError in the last log lines"; fi
  if printf '%s' "$logs" | grep -q -i -E 'out of memory|oom'; then bad "logs mention out-of-memory"; fi
}

local_run() {
  need docker; need python3
  local here root img="twister-worker-smoke" port=18765 name="twister-worker-smoke-$$"
  here="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$here")"
  docker build -t "$img" "$root" >/dev/null && ok "docker build" || { bad "docker build"; return; }

  # Fake API: answers every claim with {"job": null} and counts requests, checking the signature headers exist.
  python3 - "$port" <<'PY' &
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        ok = self.headers.get("X-Worker-Timestamp") and str(self.headers.get("X-Worker-Signature", "")).startswith("sha256=")
        body = b'{"job": null}' if ok else b'{}'
        self.send_response(200 if ok else 403); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        print("claim", "signed" if ok else "UNSIGNED", flush=True)
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", int(sys.argv[1])), H).serve_forever()
PY
  local api_pid=$!
  trap 'kill $api_pid 2>/dev/null; docker rm -f "$name" >/dev/null 2>&1' RETURN

  docker run -d --name "$name" --add-host=host.docker.internal:host-gateway \
    -e API_BASE_URL="http://host.docker.internal:$port/api/v1" -e WORKER_SHARED_SECRET=smoke -e POLL_INTERVAL_S=1 \
    "$img" >/dev/null || { bad "docker run"; return; }
  sleep 8
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ]; then ok "container running"; else bad "container exited: $(docker logs "$name" 2>&1 | tail -3)"; return; fi
  docker exec "$name" python -m twister_worker.health && ok "liveness file fresh (HEALTHCHECK command)" || bad "health command failed"
  docker exec "$name" ffmpeg -version >/dev/null 2>&1 && ok "ffmpeg present" || bad "ffmpeg missing in image"
  docker logs "$name" 2>&1 | grep -q -E 'HTTP 403|Traceback' && bad "container logs show errors" || ok "no errors in container logs"
  [ "$(docker exec "$name" id -u)" != 0 ] && ok "runs as non-root" || bad "runs as root"
  local t0=$SECONDS
  docker stop -t 30 "$name" >/dev/null && [ $((SECONDS - t0)) -lt 25 ] && ok "stops promptly on SIGTERM ($((SECONDS - t0)) s)" || bad "slow or failed stop"
}

case "${1:-}" in
  remote) remote;;
  local)  local_run;;
  *) echo "usage: $0 remote|local" >&2; exit 2;;
esac
echo
[ "$FAILS" -eq 0 ] && { echo "SMOKE OK"; exit 0; } || { echo "SMOKE FAILED ($FAILS)"; exit 1; }
