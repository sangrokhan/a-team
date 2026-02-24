# Codex Team 오케스트레이션 구현 사양서

작성일: 2026-02-21
최종 정합본: `services/api` + `services/worker` TypeScript 구현

이 문서는 팀 모드의 구현 기준을 단일 소스로 정리합니다. 운영/운영절차는 `docs/CODEX_TEAM_WORKFLOW.md`에서 이어집니다.

## 0. Reference-first 정합 기준

- 우선 참조 문서: `docs/REFERENCE_TEAM_WORKFLOW.md`
- 구현 기준 우선순위: `docs/DECISIONS.md` > `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md` > `docs/CODEX_TEAM_WORKFLOW.md` > `docs/TYPESCRIPT_OPERATIONS.md` > OpenAPI/코드
- 레퍼런스 단계(`team-plan`, `team-prd`, `team-exec`, `team-verify`, `team-fix`)는 `transition event` 기반으로 직접 구현된다. `team` 파이프라인 phase는 이벤트(`plan_ready`, `tasks_started`, `verification_required`, `fix_attempt`, `verification_resumed`, `complete`, `failed`, `cancelled`)에 따라 갱신된다.
- 종료 상태는 레퍼런스 명칭과 구현 명칭을 분리해 해석한다: `complete`→`succeeded`, `cancelled`→`canceled`.

## 1. 문서 동기화 기준

- 기준 스토리지: `.a-team/state/jobs/<job-id>/record.json`(또는 `.a-team/state/jobs/.queue` 큐 연동)
- 이벤트 로그: `events.jsonl` append-only
- API 계약 우선순위: `docs/openapi/openapi.v1.yaml` > 런타임 코드
- 현재 구현 표준 API: `/v1/jobs` 계열
- `/jobs/*`만 구현 표준으로 사용
- 중복/과다 설명은 `docs/CODEX_TEAM_WORKFLOW.md` 및 `docs/TYPESCRIPT_OPERATIONS.md`로 분리

## 2. 적용 범위

### 포함
- Team 모드 Job 생성, 상태 조회, 액션 처리, 이벤트 스트림
- Team 상태머신 및 의존성 스케줄링
- 승인 게이트, retry/fix loop, 비정상 복구(lease/heartbeat)
- tmux 시각화(선택), 파일 기반 SSOT 운영

### 제외
- 완전한 분산 워커 플랫폼(현재 claim-heartbeat는 1단계 범위)
- 외부 대시보드/지표 수집기 구축(운영 확장 범위)

## 3. 핵심 상태 계약

### Job 상태
- `queued`
- `running`
- `waiting_approval`
- `succeeded`
- `failed`
- `canceled`

### Task 상태
- `queued`
- `running`
- `succeeded`
- `failed`
- `blocked`
- `canceled`

### 기본 데이터 항목
- `id`, `name`, `role`, `dependencies`, `maxAttempts`, `timeoutSeconds`
- `attempt`, `owner`, `error`, `output`, `startedAt`, `finishedAt`
- `requiresApproval`(있으면 승인 대기)

### 레퍼런스 단계 ↔ 구현 대응

- `team-plan`: 팀 템플릿 시드/초기 runnable 계산
- `team-exec`: blocked 해제 후 배치 실행
- `team-verify`: 기본 완료 조건(queued/running/blocked 0) 및 정책 통과
- `team-fix`: retry/fixAttempt 루프
- `team-prd`: `plan_ready`/`tasks_started` 이벤트로 진입하며, queued 상태에서 실행 준비 구간을 표현한다.
- `complete/failed/cancelled`: 각각 `succeeded/failed/canceled` 상태로 운영

## 4. 아키텍처 기준

- API: `services/api`
  - Job lifecycle API 제공
  - `job.options.team.state` 저장/조회 브리지
- Worker: `services/worker/src/index.ts`
  - 팀 템플릿 시드/상태 복원/루프 실행
  - Codex 실행 위임
  - heartbeat 및 event 기록
- 저장소: 파일 기반 SSOT
  - `.a-team/state/jobs/<job-id>/record.json`
  - `.a-team/state/jobs/<job-id>/events.jsonl`
- 실행 방식
  - 기본 큐: 파일 큐 (`REDIS_URL` 미설정 시)
  - Redis 설정 시 BullMQ 큐 연동

## 5. 실행 흐름(현재)

1. Job 생성(`POST /v1/jobs`, `mode: team`)
2. 템플릿 정규화(`teamTasks`, `parallelTasks`, `maxFixAttempts`)
3. Team 상태 초기화
4. 실행 루프
   - blocked/dependency 조건을 만족한 태스크만 Runnable 산출
   - `parallelTasks` 기준으로 배치 실행
   - 실패시 retry/복구 경로 적용
5. 승인 요구
   - `requiresApproval`이 감지되면 run을 `waiting_approval`
6. 완료 판정
   - `queued=0 && running=0 && blocked=0`
   - 검증/정책 통과
   - fail limit 초과 시 `failed`
7. SSE 및 상태 API로 운영자 가시성 확보

## 6. P0~P3 통합 체크리스트

- [x] P0: 상태 저장소 SSOT 통일
- [x] P0: 병렬 실행(배치 기반), lease/heartbeats 기본 반영
- [x] P0: 승인 게이트(`waiting_approval`)와 액션 회로 연결
- [x] P1: dead/non-reporting worker 탐지 및 재배정 강화(부분 반영)
- [x] P1: 역할 산출물 파이프라인 연계(부분 반영)
- [x] P2: tmux 역할 시각화 옵션 반영
- [x] P2: 모니터링 지표 카테고리 정합화
- [x] P3: 통합 시나리오 점검

## 7. 현재 API 표준 (정상 운영)

- `GET /v1/jobs`
- `POST /v1/jobs`
- `GET /v1/jobs/{jobId}`
- `GET /v1/jobs/{jobId}/team`
- `GET /v1/jobs/{jobId}/team/mailbox`
- `POST /v1/jobs/{jobId}/team/mailbox`
- `GET /v1/jobs/{jobId}/events` (SSE)
- `GET /v1/jobs/{jobId}/events/list`
- `POST /v1/jobs/{jobId}/actions/{action}`
- `GET /v1/monitor/overview`

## 8. 구현 상태 요약

### 완료
- Team roles(Planner/Researcher/Designer/Developer/Executor/Verifier) 동작
- 의존성 기반 task 스케줄링
- retry/fix loop
- 승인 API 처리(approve/reject/resume)
- 이벤트 스트림 + 상태 조회
- heartbeat/claim 기본 재할당
- tmux 시각화 옵션
- cancel/resume 동작에서 팀 취소 메타(`requested`, `requestedAt`, `preserveForResume`)와 pipeline 메타(`pipelinePhase`, `phaseHistory`, `execution`) 동기화
- 팀 상태 메타데이터(`phaseHistory`, `execution`, `fixLoop`, `cancel`) 보존 및 이벤트 연동
- task 단위 승인 정책 고도화:
  - task output의 `approvalAutoApprove`/`requiresApproval` 신호 반영
  - policy 우선순위(명시 신호 > 정책 규칙)
  - 조건부 자동승인(역할/키워드/riskScore, 금지 조건 반영)

### 진행 중 / 미완성
- structured output 파싱 신뢰성 향상 (기본 파서 + 재시도는 동작, 다중 형식/경계조건 강건화는 미완료)
- 분산 워커 메시지 자동 협의 루프(질의/지시) 확장 (mailbox 전송/재할당은 동작, 질문-응답 협의 자동화 확장)
- 고급 성능/비용 지표 정교화 (기본 토큰·기간·실행 집계는 동작, 다차원 비용 분석/경보/트렌드는 미완료)

## 9. 운영 연계

팀 운영의 상세한 절차와 상태 동기화 규칙은 `docs/CODEX_TEAM_WORKFLOW.md`로 이동합니다.
- 상태 동기화/동시성 충돌 정책
- 완료 조건
- dead/non-reporting worker 처리
- mailbox 처리 절차

## 10. 빠른 실행 예시

```bash
npm install
cp .env.example .env
PORT=8080 npm run dev:local
```

Team 모드 제출 예시는 `docs/TYPESCRIPT_OPERATIONS.md` 또는 이 문서의 API 표준 섹션을 참조합니다.

## 12. 레퍼런스 반영 포인트(추적)

- 저장소는 `.a-team/state/jobs` 기준을 준수한다(레퍼런스 legacy 표기 `.omc/state/sessions`는 `.a-team/state/jobs`로 해석).
- 팀 상태 종료/실패는 run status 기준(`succeeded/failed/canceled`)으로 판정한다.
- action API는 승인/중단/재개 제어의 단일 경로이다(`approve`, `reject`, `cancel`, `resume`).
- mailbox(`question`, `instruction`, `notice`, `reassign`)는 팀 파이프라인 단계 제어가 아니라 운영 협업/재할당 경로로 취급한다.

## 13. 변경 이력

- 2026-02-23: `cancel/resume` 동작의 팀 상태(`preserveForResume`) 및 파이프라인 메타(phase/phaseHistory/execution) 동기화 구현 반영
- 2026-02-23: worker `updateJob` 누락 job 에러 코드를 ENOENT 정합성으로 정리
- 2026-02-21: 팀 문서 중복 통합(본 문서 정합본화)
- 2026-02-20: TypeScript 기준 정착(`docs/DECISIONS.md`)
