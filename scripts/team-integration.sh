#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/a-team-int-state-XXXXXX")"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/a-team-int-logs-XXXXXX")"
PORT=18090
BASE_URL="http://127.0.0.1:${PORT}"
API_LOG="$LOG_DIR/api.log"
WORKER_LOG="$LOG_DIR/worker.log"

export A_TEAM_STATE_ROOT="$STATE_ROOT"
export PORT
export WORKER_DISABLE_TMUX=1
export WORKER_TMUX_FALLBACK=1

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_ROOT"
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT INT TERM

wait_for_api() {
  for _ in $(seq 1 120); do
    if curl -sS "${BASE_URL}/v1/jobs" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] API not ready after 120s"
  echo "--- API LOG ---"
  tail -n 80 "$API_LOG" || true
  return 1
}

get_status() {
  local job_id="$1"
  local body
  body="$(curl -sS "${BASE_URL}/v1/jobs/${job_id}")"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(String(data.status || ''));" <<< "$body"
}

get_event_count() {
  local job_id="$1"
  local body
  body="$(curl -sS "${BASE_URL}/v1/jobs/${job_id}/events/list?limit=200")"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); console.log(Array.isArray(data) ? data.length : 0);" <<< "$body"
}

run_scenario() {
  local label="$1"
  local payload_file="$2"
  local expected_status="$3"
  local timeout_seconds="${4:-30}"

  echo "[SCENARIO] ${label}"

  local response
  response="$(curl -sS -X POST "${BASE_URL}/v1/jobs" -H "Content-Type: application/json" --data @"${payload_file}")"
  local job_id
  job_id="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if(!data.jobId){process.exit(1);} process.stdout.write(data.jobId);" <<< "$response")"
  if [[ -z "$job_id" ]]; then
    echo "[FAIL] ${label}: no jobId returned"
    return 1
  fi

  echo "[SCENARIO] job=${job_id}"

  local status=""
  for i in $(seq 1 "$timeout_seconds"); do
    status="$(get_status "$job_id")"
    if [[ "$status" == "succeeded" || "$status" == "failed" || "$status" == "canceled" ]]; then
      break
    fi
    sleep 1
  done

  if [[ "$status" != "$expected_status" ]]; then
    local error_status
    error_status="$(curl -sS "${BASE_URL}/v1/jobs/${job_id}" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(String(data.error || ''));" )"
    local event_count
    event_count="$(get_event_count "$job_id")"
    echo "[FAIL] ${label}: expected ${expected_status}, got ${status} job=${job_id}"
    echo "[INFO] events=${event_count} error='${error_status}'"
    return 1
  fi

  local event_count
  event_count="$(get_event_count "$job_id")"
  local team_status
  team_status="$(curl -sS "${BASE_URL}/v1/jobs/${job_id}/team" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(String(data.status || ''));" )"

  echo "[PASS] ${label}: status=${status}, team_status=${team_status}, events=${event_count}"
}

cd "$ROOT_DIR"

(npm run dev:api >"$API_LOG" 2>&1 & echo "$!" ) > /tmp/team-integration-api.pid
read -r API_PID < /tmp/team-integration-api.pid

(WORKER_DISABLE_TMUX=1 WORKER_TMUX_FALLBACK=1 npm run dev:worker >"$WORKER_LOG" 2>&1 & echo "$!" ) > /tmp/team-integration-worker.pid
read -r WORKER_PID < /tmp/team-integration-worker.pid

echo "[INFO] API pid=$API_PID, worker pid=$WORKER_PID"

wait_for_api
echo "[INFO] API ready"

PAYLOAD_SUCCESS_MIN="/tmp/team-integration-minimal.json"
cat > "$PAYLOAD_SUCCESS_MIN" <<'EOF'
{
  "provider": "codex",
  "mode": "team",
  "repo": "file:///Users/han/Repo/a-team",
  "ref": "main",
  "task": "integration minimal planner task (smoke)",
  "options": {
    "team": {
      "parallelTasks": 1,
      "teamTasks": [
        {
          "name": "quick planner smoke",
          "role": "planner",
          "maxAttempts": 1,
          "timeoutSeconds": 60
        }
      ]
    },
    "agentCommands": {
      "planner": "echo planner done"
    }
  }
}
EOF

PAYLOAD_SUCCESS_FULL="/tmp/team-integration-full.json"
cat > "$PAYLOAD_SUCCESS_FULL" <<'EOF'
{
  "provider": "codex",
  "mode": "team",
  "repo": "file:///Users/han/Repo/a-team",
  "ref": "main",
  "task": "integration full team pipeline (smoke)",
  "options": {
    "team": {
      "parallelTasks": 2,
      "maxFixAttempts": 1
    },
    "agentCommands": {
      "planner": "echo planner done",
      "researcher": "echo research done",
      "designer": "echo design done",
      "developer": "echo dev done",
      "executor": "echo exec done",
      "verifier": "echo verify done"
    }
  }
}
EOF

PAYLOAD_FAIL="/tmp/team-integration-fail.json"
cat > "$PAYLOAD_FAIL" <<'EOF'
{
  "provider": "codex",
  "mode": "team",
  "repo": "file:///Users/han/Repo/a-team",
  "ref": "main",
  "task": "integration failure path (smoke)",
  "options": {
    "team": {
      "maxFixAttempts": 1,
      "teamTasks": [
        {
          "name": "failing planner",
          "role": "planner",
          "maxAttempts": 1,
          "timeoutSeconds": 60
        }
      ]
    },
    "agentCommands": {
      "planner": "bash -lc 'exit 1'"
    }
  }
}
EOF

run_scenario "TEAM_MINIMAL_SUCCESS" "$PAYLOAD_SUCCESS_MIN" "succeeded" 30
run_scenario "TEAM_FULL_SUCCESS" "$PAYLOAD_SUCCESS_FULL" "succeeded" 40
run_scenario "TEAM_FAIL_WITH_RETRY_LIMIT" "$PAYLOAD_FAIL" "failed" 40

echo "[INFO] integration smoke finished"
