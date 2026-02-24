# 팀 순차 실행(Stage Handoff) 구현 문서 초안 (코드 기준)

> 이 문서는 기존 레퍼런스(과거 설계 방향)와 현재 구현 기준을 병합한 운영용 정합본입니다.  
> 기존 레퍼런스의 본문을 유지하면서, 하단의 "운영 정합 가이드"에서 구현 차이 대응을 명시합니다.

본 문서의 구현 파일 참조 경로는 상위 디렉터리(`../`)에서 `oh-my-claudecode`로 이동해 접근하는 방식이 기준입니다 (`../oh-my-claudecode/...`).
`docs/` 폴더에서 직접 열어 확인할 때는 `../../oh-my-claudecode/...`로 계산해도 동일 위치를 가리킵니다.

## 1) 기능 단위: 팀 파이프라인 상태 모델 정의

- 목적: team-plan → team-prd → team-exec → team-verify → team-fix와 터미널 상태를 정합성 있게 추적한다.
- 핵심 파일: ../oh-my-claudecode/src/hooks/team-pipeline/types.ts, ../oh-my-claudecode/src/hooks/team-pipeline/state.ts
- 필수 상태 항목
  - phase: team-plan, team-prd, team-exec, team-verify, team-fix, complete, failed, cancelled
  - phase_history: 단계 진입 이력(phase, entered_at, reason?)
  - active, session_id, iteration, max_iterations, started_at, updated_at, completed_at
  - artifacts: plan_path, prd_path, verify_report_path
  - execution: workers_total, workers_active, tasks_total, tasks_completed, tasks_failed
  - fix_loop: attempt, max_attempts, last_failure_reason
  - cancel: requested, requested_at, preserve_for_resume

## 2) 기능 단위: 상태 초기화/조회/저장/삭제 API

- 목적: 세션 단위 팀 상태를 안전하게 생성·조작·소거한다.
- 핵심 파일: ../oh-my-claudecode/src/hooks/team-pipeline/state.ts
- 동작
  - initTeamPipelineState(directory, sessionId, options?)로 기본 상태 생성
  - readTeamPipelineState(directory, sessionId)는 세션 단위 경로(.a-team/state/jobs/{sessionId}/team-state.json)에서만 읽는다
  - writeTeamPipelineState(...)는 session_id, mode, schema_version, updated_at을 보강해 저장
  - clearTeamPipelineState(...)는 세션 상태 파일 삭제
- 경로 원칙: 세션이 없으면 읽기/쓰기/삭제를 수행하지 않음

## 3) 기능 단위: 단계 전이(Transition) 가드 엔진

- 목적: 잘못된 상태 전이를 막고, 다음 단계 진입 조건을 강제한다.
- 핵심 파일: ../oh-my-claudecode/src/hooks/team-pipeline/transitions.ts
- 핵심 규칙
  - 이벤트 기반 전이
    - `plan_ready`: team-plan/team-prd/failed/complete → team-prd
    - `tasks_started`: team-plan/team-fix/cancelled → team-exec
    - `verification_required`: team-prd/team-exec/team-fix → team-verify
    - `verification_resumed`: team-verify → team-exec
    - `fix_attempt`: team-prd/team-exec/team-verify → team-fix
    - `complete`: team-prd/team-exec/team-verify/team-fix → complete
    - `failed`: team-prd/team-exec/team-verify/team-fix → failed
    - `cancelled`: team-plan/team-prd/team-exec/team-verify/team-fix → cancelled
  - team-exec는 plan_path 또는 prd_path 중 하나가 있어야 함
  - team-verify는 tasks_total/tasks_completed가 음이 아닌 정수이며 tasks_total>0, tasks_completed>=tasks_total 이어야 함
  - cancelled에서 복귀 시 preserve_for_resume=true가 아니면 resume 불가
- 반복 제어
  - team-fix 진입 시 fix_loop.attempt 증가
  - attempt > max_attempts면 자동으로 failed로 전이 + 사유 기록

## 4) 기능 단위: 단계 기록(히스토리) 및 종료 처리

- 목적: 어떤 근거로, 언제, 왜 전이되었는지 감사 가능하게 남긴다.
- 핵심 파일: ../oh-my-claudecode/src/hooks/team-pipeline/state.ts:markTeamPhase
- 동작
  - phase_history append
  - 종료 단계(complete|failed|cancelled)에서 active=false, completed_at set
  - fix-loop 초과 시 실패사유(fix-loop-max-attempts-exceeded)와 함께 실패 이력 추가

## 5) 기능 단위: 세션-스코프 상태 해석(후방호환 포함)

- 목적: Hook이 팀 상태를 읽을 때 과거 key 호환성(stage, current_stage 등) 지원
- 핵심 파일: ../oh-my-claudecode/src/hooks/bridge.ts
- 동작
  - readTeamStagedState가 legacy/세션 상태 둘 다 읽어 해석
  - getTeamStage가 stage/current_stage/currentStage를 fallback으로 읽음
  - isTeamStateTerminal이 terminal, cancelled, status 기반으로 종료 판단

## 6) 기능 단위: Stop/세션 시작 시 팀 상태 지속성 메시지

- 목적: 세션 재개 시 컨텍스트 복원 및 비정상 종료 후 연속 수행 유도
- 핵심 파일: ../oh-my-claudecode/src/hooks/bridge.ts, ../oh-my-claudecode/src/hooks/persistent-mode/index.ts
- 동작
  - session-start: 활성 팀이 있으면 [TEAM MODE RESTORED] 메시지 + stage prompt injection
  - stop hook: 팀이 active/비종료면 [TEAM MODE CONTINUATION]으로 진행 유도 메시지 삽입
  - 팀 터미널 시 cleanup 유도 메시지

## 7) 기능 단위: 팀-러프(ralph) 연동 제어

- 목적: 팀 파이프라인 상태에 따라 ralph 지속 루프를 완료/중단 처리
- 핵심 파일: ../oh-my-claudecode/src/hooks/ralph/loop.ts, ../oh-my-claudecode/src/hooks/persistent-mode/index.ts
- 동작
  - getTeamPhaseDirective는 team 상태가 team-verify|team-fix|team-exec|team-plan|team-prd면 continue
  - team가 complete/failed/cancelled면 ralph 중단 경로로 판단 가능
  - persistent-mode에서 team terminal이면 ralph/ultrawork/verification 상태 정리

## 8) 기능 단위: 상태 읽기/쓰기 도구(MCP)와 팀 모드 인터페이스

- 목적: 팀 파이프라인 상태를 외부에서 명시적으로 조회/수정/삭제
- 핵심 파일: ../oh-my-claudecode/src/tools/state-tools.ts
- 지원 모드 목록에 team 포함
- state_read/state_write/state_clear에서 session_id 지원
- state_write는 명시 파라미터 + 자유 state 병합, 메타 _meta 추가
- 경고: session_id 미지정 시 legacy 경로 병합(멀티 세션 오염 위험) 안내

## 9) 기능 단위: 팀 멤버 통합 조회

- 목적: Claude 네이티브 팀 + MCP 워커를 하나의 멤버 뷰로 취합
- 핵심 파일: ../oh-my-claudecode/src/team/unified-team.ts, ../oh-my-claudecode/src/team/capabilities.ts
- 처리
  - Claude 팀 멤버(config.json) 파싱
  - MCP 멤버는 등록/heartbeat 상태 반영
  - 상태 계산: active/idle/dead/quarantined/unknown

## 10) 기능 단위: 결과 전달 라우팅(다음 단계에 쓰일 산출 전달)

- 목적: 기존 경로별로 메시지 전송 채널 분기
- 핵심 파일: ../oh-my-claudecode/src/team/message-router.ts
- 동작
  - Claude 멤버: SendMessage로 라우팅 안내
  - MCP 멤버: Claude teams 설정의 inbox JSONL 쓰기
- 보조 경로: MCP 브릿지(outbox/inbox)로 작업 결과 요약을 리드에게 전달
- 핵심 파일: ../oh-my-claudecode/src/team/inbox-outbox.ts, ../oh-my-claudecode/src/team/mcp-team-bridge.ts, ../oh-my-claudecode/src/team/team-status.ts
  - 완료/실패/오류는 task_complete, task_failed, error 등 JSON 메시지로 남김
  - 리더가 다음 단계 판단 시 이 결과를 참고해 verify/fix 의사결정에 반영 가능

## 11) 기능 단위: 작업 실행 산출물 집계(핵심 지표)

- 목적: team-verify 진입 조건에서 필요
- 핵심 지표 필드: execution.tasks_total, execution.tasks_completed, execution.tasks_failed
- 검증 지점: `verification_required` 이벤트의 guard 통과
- 관련 파일: ../oh-my-claudecode/src/hooks/team-pipeline/transitions.ts, ../oh-my-claudecode/src/team/task-router.ts, ../oh-my-claudecode/src/team/team-status.ts

## 12) 기능 단위: 취소/복구/재개 정책

- 목적: 중단 후 이어받기 및 안전한 종료 보장
- 핵심 파일: ../oh-my-claudecode/src/hooks/team-pipeline/transitions.ts, ../oh-my-claudecode/src/hooks/team-pipeline/state.ts
- 정책
  - 취소 상태는 requested, requested_at, preserve_for_resume 저장
  - 취소에서 바로 재개하려면 preserve_for_resume=true 조건 필요
  - 완료/실패/취소 시 active=false, completed_at 갱신
- 운영: cancel 동작은 현재 팀 스킬 문서에서 상세(요청/팀 종료/상태 정리), 실제 구현은 팀 파이프라인 상태를 통해 후속 제어 수행

## 13) 기능 단위: 테스트 정합성 규격

- 핵심 테스트: ../oh-my-claudecode/src/hooks/team-pipeline/__tests__/transitions.test.ts
- 검증 항목
  - legal transition 흐름 (plan→prd→exec)
  - illegal transition 차단
  - fix-loop 초과 시 failed 강제
  - numeric guard(isNonNegativeFiniteInteger) 포맷·범위 검증
  - verify 진입 조건의 정합성(0, NaN, Infinity, 음수, 미완료)

---

## 14) 현재 구현 정합 가이드 (Reference-first + TS 운영 기준 병합)

`docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`, `docs/CODEX_TEAM_WORKFLOW.md`, `docs/TYPESCRIPT_OPERATIONS.md`를 기준으로 현재 구현은 다음으로 정합된다.

### A. 상태/저장소 기준(현재 운영 진리)

- 저장 소스: `.a-team/state/jobs/<job-id>/record.json`
- 이벤트: `.a-team/state/jobs/<job-id>/events.jsonl` (append-only)
- API 상태: `queued | running | waiting_approval | succeeded | failed | canceled`
- task 상태: `queued | running | succeeded | failed | blocked | canceled`
- 병렬 실행: `parallelTasks`, `maxFixAttempts`, `teamTasks` 기반

### B. 레퍼런스 항목 대비 구현 대응

- `team-plan / team-prd / team-exec / team-verify / team-fix`:
  - 구현에서 transition event(`plan_ready`, `tasks_started`, `verification_required`, `verification_resumed`, `fix_attempt`, `complete`, `failed`, `cancelled`)로 직접 전환 기록을 남기고, 태스크 의존성·완료 상태·승인 게이트는 이벤트 타이밍 판단 근거로 사용됨
- `complete / failed / cancelled`:
  - 현재 종료 상태는 `succeeded / failed / canceled`로 정리
- `stage 전환 전용 API`:
  - 현재는 `POST /v1/jobs/{jobId}/actions/{action}`, `POST /v1/jobs/{jobId}/team/tasks/{taskId}/actions/{action}` 중심으로 제어
- `session path(.a-team/state/jobs/...)`:
  - 현재 기준 경로는 `.a-team/state/jobs/...`를 기본으로 사용
- mailbox:
  - 현재 자동화는 `question`, `instruction`, `notice`, `reassign` 중심 + worker heartbeat/non-reporting 복구 경로 반영

### C. 구현-문서 충돌이 생길 때 우선순위

- 1순위: `docs/DECISIONS.md` (TypeScript 기준, 파일 SSOT)
- 2순위: `docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md`
- 3순위: `docs/CODEX_TEAM_WORKFLOW.md`, `docs/TYPESCRIPT_OPERATIONS.md`
- 4순위: `docs/openapi/openapi.v1.yaml`
- 5순위: 코드(실행 동작)

### D. 병행 정비 체크리스트

1. 레퍼런스 문구의 경로/상태를 현재 운영 경로(`.a-team/state/jobs`)와 상태어휘(`succeeded/canceled`)로 정합
2. `team-* phase` 문서와 실행 상태(`pipelinePhase`/`phaseHistory`) 반영이 누락되지 않았는지 교차 확인
3. 승인/재시도/복구 플로우를 action API와 이벤트로 추적 가능하게 유지
4. 문서 간 상태어휘 차이는 표준 용어 사전으로 통일
