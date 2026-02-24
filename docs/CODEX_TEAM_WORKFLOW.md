# 팀 오케스트레이션 실행 워크플로우

## 0. 기준 정합 안내

- 기준 문서: `docs/REFERENCE_TEAM_WORKFLOW.md` (기준)
- 보조 기준:
  - 구현 기준: `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`
  - 운영 가이드: `docs/TYPESCRIPT_OPERATIONS.md`
  - 결정사항: `docs/DECISIONS.md`

정합 규칙:
- 상태 전이는 `team-plan → team-prd → team-exec → team-verify → team-fix` 모델을 개념적으로 수용하되, 현재 실행은 transition event(`plan_ready`, `tasks_started`, `verification_required`, `verification_resumed`, `fix_attempt`, `complete`, `failed`, `cancelled`) 기반의 `pipelinePhase` 동기화와 task/run 상태 제어를 함께 사용한다.
- 상태 저장은 `.a-team/state/jobs/<job-id>/` 경로를 기준으로 본다.  
  (레퍼런스의 `.omc/state/sessions` 표기는 `.a-team/state/jobs` 기준으로 해석)
- 종료 상태 어휘는 `complete/cancelled`가 아니라 `succeeded/canceled`를 사용한다.
- 상태 영속성은 `record.json` + `events.jsonl` 기반으로 보며, 단계 이력은 이벤트 이력로 추적한다.

### 레퍼런스 단계 ↔ 현재 구현 매핑

- `team-prd`, `team-verify`, `team-fix`: 구현에서는 transition event(`plan_ready`, `tasks_started`, `verification_required`, `verification_resumed`, `fix_attempt`, `complete`, `failed`, `cancelled`)로 phase 동기화를 남기고, task/run 상태로 실행 제어를 수행한다.
- `plan`: 팀 템플릿 시드(`teamTasks`, `parallelTasks`, `maxFixAttempts`)와 첫 runnable 산출을 의미한다.
- `exec`: blocked/dependency 조건 충족 태스크의 배치 실행에 해당한다.
- `complete`: run 상태 `succeeded`.
- `failed`: run 상태 `failed`.
- `cancelled`: run 상태 `canceled`.

## 1. 목적

Team 모드의 운영 전 과정을 단일 참조점으로 정리한다.

- 대상 범위: `services/api`, `services/worker`, 파일 기반 SSOT
- 기준 API: `/v1/jobs/*`
- 기준 사양: `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`
- 운영 가이드: `docs/TYPESCRIPT_OPERATIONS.md`

## 2. Dispatch(작업 분배)

### 2.1 시작 절차

1. `POST /v1/jobs` with `mode: "team"`
2. 템플릿 또는 사용자 제공 `teamTasks` 정규화
3. team state 초기 seed 수행
4. runnable task 계산 규칙(`blocked`/의존성)으로 실행 루프 진입

### 2.2 역할 체계

- Planner
- Researcher
- Designer
- Developer
- Executor
- Verifier

### 2.3 병렬 실행

- 한 루프에서 `parallelTasks` 상한까지만 배치 실행
- owner/claim 임시 배정 후 실행

## 3. Completion Tracking(완료 관리)

### 3.1 완료 후보 조건

- `queued == 0`
- `blocked == 0`
- `running == 0`

### 3.2 운영 완료 조건

- 위 기본 조건 충족
- verify 단계 통과
- 정책상 허용 실패 범주 충족

### 3.3 상태 갱신 규칙

- `failed`는 `maxFixAttempts`, `maxAttempts`로 `retry` 또는 `failed` 분기
- dead/non-reporting worker 감지 시 task 재배정

## 4. Collaboration(협의/협상)

### 4.1 현재 구현 범위

- mailbox 조회/발송
  - `GET /v1/jobs/{jobId}/team/mailbox`
  - `POST /v1/jobs/{jobId}/team/mailbox`
- 메시지 타입
  - `notice`, `question`, `instruction`, `reassign`
- 자동 처리 범위
  - 현재는 `reassign` 중심 자동화

### 4.2 분배/완료 가이드

- 협의 포인트는 task 상태/heartbeat/실행 완료 신호와 묶어 추적
- 요청/완료 상태는 Team state와 이벤트가 일치해야 함

## 5. 동기화/상태 규격

### 5.1 SSOT

- Team state: `.a-team/state/jobs/<job-id>/record.json`
- 이벤트 로그: `.a-team/state/jobs/<job-id>/events.jsonl`
- 이벤트는 append-only

### 5.2 동기화 체크포인트

- 상태 전환 시 즉시 저장
- resume/restart는 마지막 state 기준으로 재동기화
- 이벤트 및 상태 스냅샷은 감사 증적으로 보존

### 5.3 완료/중단/재개 인터페이스

- 완료: `waiting` 조건 해제 + verify 통과
- 종료: run 취소 신호 처리 후 task 정리
- 재개: `POST /v1/jobs/{jobId}/actions/resume`

## 6. 안정성: Lease, Heartbeat, Reassign

- heartbeart 누락/비정상 연속 시 non-reporting 전환
- claim lease 만료 또는 작업자 비정상 시 재할당
- 동일 task 중복 claim 방지 우선으로 상태 반영
- 재시도는 `Team state` 기반으로 멱등 동작

## 7. 승인 게이트

- `requiresApproval` 감지 시 run 상태를 `waiting_approval`로 전환
- 승인 액션
  - `POST /v1/jobs/{jobId}/actions/approve`
  - `POST /v1/jobs/{jobId}/actions/reject`
  - `POST /v1/jobs/{jobId}/actions/resume`

## 8. 종료/재개

- `cancel`, `resume`은 action API로 제어
- resume은 진행 중이던 task를 상태 기반으로 재큐

## 9. tmux 시각화(옵션)

- `options.team.tmuxVisualization=true`이면 역할별 pane 시각화와 attach 정보 발행
- 판단 기준은 tmux가 아닌 `/v1/jobs/{jobId}/team` 상태를 우선 사용

## 10. 운영 체크리스트

1. `GET /v1/jobs/{jobId}/team`에서 runnable/task 상태 확인
2. `events`에서 `team.task.started`, `team.task.completed`, `team.task.auto_approved`, `team.retry`, `team.task.approval_required` 확인
3. 승인 대기(`waiting_approval`) 시 action 처리 확인
4. `non-reporting`/lease 만료 시 재배정 경로 점검
5. `resume` 후 parallelTasks, deadlock 카운트, verify 경로 점검

## 14. Reference 정합 운영 체크리스트 (반영 항목)

1. `docs/REFERENCE_TEAM_WORKFLOW.md`의 단계 모델은 transition event를 통해 phase 동기화와 실행 상태 전이를 함께 관리한다.
2. `/v1/jobs/*`는 실행 표준이다.
3. SSOT/이벤트 경로는 `.a-team/state/jobs/<job-id>/`로 통일한다.
4. `TeamState`/Task 상태값은 openapi의 열거형 기준을 따른다.
5. 종료 판단은 레퍼런스의 `complete/failed/cancelled` 용어를 현재 구현 용어(`succeeded/failed/canceled`)로 번역해 읽는다.

## 11. 구현 전달용 상태(축약본)

### 현재 적용 요약

- Team role 템플릿 및 기본 실행 루프
- 상태 SSOT 및 이벤트 저장
- 승인/재개 action 처리
- task retry/fix loop
- tmux 시각화 옵션

### 후속 과제
- worker 간 질의/지시 자동 협의 라우팅 확장
- worktree 격리와 패치 병합 자동화 고도화
- structured output 파이프라인 강화

## 12. 동기화 규격 체크리스트(요약)

- SSOT 경로: `.a-team/state/jobs/<job-id>/record.json`
- 이벤트: `events.jsonl` append-only
- task 동기화: dependency + blocked release + 집계
- heartbeat/non-reporting/reassign 반영
- 완료/재개/중단 루틴 일관성

## 13. 연계 문서

- 구현 사양: `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`
- 운영 가이드: `docs/TYPESCRIPT_OPERATIONS.md`
- 운영 결정: `docs/DECISIONS.md`
