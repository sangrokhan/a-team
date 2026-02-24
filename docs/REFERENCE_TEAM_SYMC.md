  # 팀 파이프라인 & 컨텍스트 동기화 설계(재구성본)

  ## 1. 목적

  - team-prd, team-plan, team-exec를 포함한 팀 실행 흐름을 상태 머신 기반으로 안정적으로 운영
  - 세션 변경/중단/재개 시에도 진행 상태를 자동 복원
  - 다중 팀 환경에서 동시 작업 시 충돌 없이 동기화
  - Lead/worker 간 컨텍스트 공유를 완전 로그 재파싱 없이 증분적으로 수행

  ## 2. 적용 범위

  - 모드 운영: team-mode 진입/진행/종료
  - 파이프라인 단계 전이: team-plan → team-prd → team-exec → team-verify → team-fix
  - 팀 작업 동기화(작업 큐, 락, 메시지 큐, 커서)
  - 세션 간 복원과 멀티팀 분리

  ## 3. 핵심 설계 원칙

  - 진실의 단일 원천은 “상태 파일”이다.
  - 컨텍스트 복원은 “상태 + 델타” 기반으로 처리한다.
  - 충돌은 경로 네임스페이스와 파일 락으로 방지한다.
  - 단계 전이 규칙은 정적(명시적 허용 전이)으로 강제한다.

  ## 4. 상태 모델

  ### 4.1 팀 파이프라인 상태

  - 상태 타입: team-plan, team-prd, team-exec, team-verify, team-fix
  - 저장 위치: .omc/state/sessions/{sessionId}/team-state.json
  - 핵심 필드
      - session_id
      - team_name
      - mode(현재 단계)
      - status(active/paused/completed/error)
      - attempt, created_at, updated_at
      - plan_path, prd_path, exec_manifest(산출물 경로 참조)
      - active_task_count, completed_task_count 등 단계별 카운트
      - phase_history(선택적)

  참조: src/hooks/team-pipeline/types.ts, src/hooks/team-pipeline/state.ts

  ### 4.2 전이 규칙(Validation)

  - 허용 전이만 가능 (team-plan → team-prd → team-exec …)
  - 전이 전에 선행 산출물 유효성 검사
      - 예: team-plan 완료 시 plan 산출물 존재성 점검
      - 예: team-exec 시작 전 prd 참조 유효성 점검
  - 무효 전이 차단 시 사용자 안내와 함께 상태 유지

  참조: src/hooks/team-pipeline/transitions.ts

  ## 5. 세션 관리 및 복원

  ### 5.1 세션 식별

  - getProcessSessionId()로 실행 단위별 고유 ID 생성 (pid-...)
  - 세션별 state 경로 분리
  - sessionId가 존재하면 다른 세션 상태를 자동 폴백하지 않음(강한 격리)

  참조: src/lib/worktree-paths.ts

  ### 5.2 세션 시작/재개 동작

  - 세션 시작 훅에서 기존 team state를 읽고 현재 단계 기반 프롬프트로 복원
  - 중단/재시작 시 TEAM MODE CONTINUATION 메시지로 이어붙이기
  - 결과적으로 lead는 전체 컨텍스트를 다시 읽는 방식이 아니라 상태 스냅샷을 기반으로 재진입

  참조: src/hooks/bridge.ts

  ## 6. 팀 내부 동기화(Lead/Worker)

  ### 6.1 작업 큐 모델

  - 작업은 파일 기반 task 객체 단위로 관리
  - 상태 흐름: pending → in_progress → completed
  - blockedBy 같은 의존성 메타데이터로 DAG 제어
  - 작업 claim에 락 사용(동시 claim 방지)

  참조: src/team/task-file-ops.ts

  ### 6.2 메시징(lead ↔ worker)

  - Inbox/Outbox는 JSONL append 로그
  - 커서(offset) 기반 증분 읽기
  - 매 메시지를 재파싱할 필요 없이 “읽은 위치”만 관리해 동기화 비용 최소화

  참조: src/team/inbox-outbox.ts

  ### 6.3 스코프 분리

  - 팀 단위 경로 네임스페이스 분리:
      - tasks: team 단위 디렉터리
      - 메시지: team 단위 inbox/outbox
  - 결과적으로 팀 간 간섭 없음

  ## 7. 멀티팀/멀티세션 동시 운영 시 설계 동작

  - 네임스페이스: 팀명 분리 + 세션별 state 파일 분리
  - 팀 내 병렬 작업은 task 수준에서만 동시성 제어
  - 세션 간 간섭은 상태 경로 분리로 차단
  - 종료 후 정리 훅에서 해당 세션의 team 상태만 정리

  ## 8. 데이터 계층 요약

  - 파이프라인 상태: .omc/state/sessions/{sessionId}/team-state.json
  - 노트/보조 컨텍스트: .omc/notepads/..., .omc/notepad.md
  - 팀 작업 큐: 팀별 task JSON 파일
  - 메시징: 팀별 inbox/outbox JSONL + cursor

  ## 9. 주요 시퀀스

  ### 9.1 실행

  1. 팀 모드 진입 시 mode 초기 상태 생성
  2. team-plan 수행 후 산출물 경로 기록
  3. team-prd 진입 시 가드 통과, prd 기록
  4. team-exec에서는 task 생성 후 worker claim 루프
  5. 완료 후 verify/fix 단계로 진행

  ### 9.2 중단/재개

  1. 세션 중단 감지
  2. 다음 세션 시작 시 state 파일 읽기
  3. TEAM MODE RESTORED 메시지로 현재 단계 주입
  4. 남은 작업만 이어서 수행(전체 컨텍스트 재파싱 없음)

  ## 10. 오류·회복 설계

  - 상태 검증 실패: 현재 단계 유지 + 명확한 오류 사유 반환
  - 락 충돌: 재시도/재획득(짧은 backoff)
  - 메시지 커서 손상: inbox 재동기화 경고 후 수동 복구 경로 제공
  - 세션 stale 정리: 완료/종료 시 상태 정리 훅 적용

  ## 11. 보안/무결성 고려

  - 경로 스코프: 팀명/세션명 기반 경로 유효성 검증
  - 작업 파일 원자성: 락과 상태 전이 원자화로 부분 쓰기 방지
  - 권한 최소화: 공유 글로벌 로그가 아닌 네임스페이스별 파일 소유범위 사용

  ## 12. 재설계 제안(현재 아키텍처의 진화 방향)

  - 상태 스키마 버저닝 추가 (schema_version)
  - 전이 실패시 structured error code 도입
  - task 상태 머신을 queued/assigned/reviewed로 정교화
  - 복구 로그(phase audit) 구조화해서 디버그/컴플라이언스 개선
  - notepad는 “운영 메모”로만 사용하고 state 필수 입력은 항상 JSON strict source로 유지
