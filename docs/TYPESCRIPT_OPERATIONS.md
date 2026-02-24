# TypeScript 운영 가이드

## 기준 정합

- 팀 모드 운영의 기준 문서 체인은 다음이다:
  - `docs/DECISIONS.md`
  - `docs/REFERENCE_TEAM_WORKFLOW.md`
  - `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`
  - `docs/CODEX_TEAM_WORKFLOW.md`
- 실행/저장 기준:
  - 상태: `/v1/jobs` 표준 API + `/a-team/state/jobs/<job-id>`
  - 종료/중단 용어: `succeeded` / `failed` / `canceled`
- 레퍼런스 단계명(`team-plan` 등)은 단계 가이드이며, 현재 실행은 `transition event`(`plan_ready`, `tasks_started`, `verification_required`, `verification_resumed`, `fix_attempt`, `complete`, `failed`, `cancelled`) 기반으로 `pipelinePhase`를 동기화하고, task/run 상태로 제어한다.

## 기준
- Node.js: 20+
- API: `services/api`
- Worker: `services/worker`
- 상태 저장: 파일 기반 (`.a-team/state/jobs`)
- Queue: `REDIS_URL` 설정 시 Redis + BullMQ, 미설정 시 파일 큐(`.a-team/state/jobs/.queue`)

## 설치/실행
```bash
npm install
cp .env.example .env
PORT=8080 A_TEAM_STATE_ROOT=$PWD/.a-team/state/jobs npm run dev:local
```
또는 `.env`를 로드해서 실행:
```bash
export A_TEAM_STATE_ROOT=$PWD/.a-team/state/jobs
npm run dev:local
```
`npm install` 시 `postinstall`로 `setup`이 실행되어
`~/.a-team`를 초기화하고 `~/.codex`, `~/.claude` 경로를 바인딩합니다.

## CLI 설치 훅/실행 구조
- 공용 엔트리: `bin/a-team.mjs`
- 디스패처: `scripts/bin/dispatch.mjs`

수동 실행:
```bash
node ./bin/a-team.mjs setup
```
모든 실행 구성요소(backend + worker + 모니터 UI)을 함께 띄우려면:
```bash
a-team run --port 8080
```

## 주요 환경변수
- `A_TEAM_STATE_ROOT`
- `REDIS_URL` (Redis 큐 사용 시)
- `PORT`
- `API_PORT` (docker compose host publish port, default `8080`)
- `WORKER_CONCURRENCY`
- `WORK_ROOT`
- `TMUX_KEEP_SESSION_ON_FINISH`
- `JOB_SKIP_GIT_CLONE`
- `JOB_PLANNER_CMD`
- `JOB_RESEARCHER_CMD`
- `JOB_DESIGNER_CMD`
- `JOB_DEVELOPER_CMD`
- `JOB_EXECUTOR_CMD`
- `JOB_VERIFIER_CMD`
Team mode( `mode: "team"` )에서 추가로 사용하는 값:
- `options.team.parallelTasks`
- `options.team.maxFixAttempts`
- `options.team.teamTasks`
- `options.team.tmuxVisualization` (`true`면 역할별 tmux pane 시각화 세션 생성)

## tmux 동작
- Worker는 job 실행 시 세션을 만들고 `planner/executor/verifier` pane을 실행합니다.
- 이벤트 `tmux_session_started` payload의 `attachCommand`로 실시간 attach 가능합니다.
- `keepTmuxSession=false`면 종료 시 세션을 정리합니다.

Team 모드(`mode: "team"`)는 현재 `planner/researcher/designer/developer/executor/verifier` 역할 템플릿 기반으로 의존성 라운드 실행합니다.
- `options.team.parallelTasks`는 동시 실행 가능한 태스크 수의 상한입니다.
- 동일 라운드에서 `parallelTasks`개 만큼 `running`으로 전환한 뒤 병렬 실행합니다.
- `options.team.tmuxVisualization=true`이면 역할별 pane을 열고 각 역할 실행 로그를 tail로 시각화합니다.
- 실행 상태는 `GET /v1/jobs/{jobId}/team` API로 확인합니다.

## 호스트 실행
```bash
PORT=8080 A_TEAM_STATE_ROOT=$PWD/.a-team/state/jobs npm run dev:local
```
모니터 페이지 기본 주소: `http://localhost:8080/monitor/`

중지: `Ctrl+C`

`PORT`로 단일 포트를 직접 제어합니다.
