import type { LocationSeed, StageDefinition, WorkflowPreset } from "./types.js";

export const DEFAULT_ENDPOINT = "ws://127.0.0.1:8765";
export const RPC_TIMEOUT_MS = 30000;
export const MAX_LOGS = 700;
export const MAX_EVENTS = 30;

export const LOCATION_SEEDS: LocationSeed[] = [
  { id: "seoul-gateway", name: "Seoul Gateway", cwd: "/Users/han/Repo/a-team" },
  { id: "tokyo-sandbox", name: "Tokyo Sandbox", cwd: "/tmp" },
  { id: "sf-orchestrator", name: "SF Orchestrator", cwd: "/tmp" },
  { id: "eu-observer", name: "EU Observer", cwd: "/tmp" }
];

export const FIXED_STAGES: StageDefinition[] = [
  {
    key: "beforeDispatch",
    title: "1) Before Dispatch",
    description: "명령 발행 직전에 공통 가드/컨텍스트를 주입"
  },
  {
    key: "afterThreadReady",
    title: "2) After Thread Ready",
    description: "스레드 준비 완료 시 공통 컨텍스트를 고정"
  },
  {
    key: "beforeTurnStart",
    title: "3) Before Turn Start",
    description: "턴 시작 직전 검증/실행 기준을 주입"
  },
  {
    key: "afterTurnCompleted",
    title: "4) After Turn Completed",
    description: "완료 후 리뷰/체크리스트를 실행"
  },
  {
    key: "onError",
    title: "5) On Error",
    description: "실패 시 원인 기록 및 재시도 전략을 주입"
  }
];

export const DEFAULT_WORKFLOW_ID = "completion-gate";

export const DEFAULT_WORKFLOWS: WorkflowPreset[] = [
  {
    id: "completion-gate",
    name: "Completion Gate",
    description: "완성도 우선 파이프라인",
    injections: {
      beforeDispatch: [
        {
          id: "bd-planner",
          agent: "planner",
          instruction: "작업 목표/제약/완료기준을 명시하고 누락 조건을 먼저 점검한다.",
          enabled: true
        },
        {
          id: "bd-context-guard",
          agent: "context_guard",
          instruction: "현재 컨텍스트 범위를 고정하고 불필요한 추정은 배제한다.",
          enabled: true
        }
      ],
      afterThreadReady: [
        {
          id: "atr-thread-keeper",
          agent: "thread_keeper",
          instruction: "선택한 워크플로우와 스레드 메타를 연결해 이후 턴에 유지한다.",
          enabled: true
        }
      ],
      beforeTurnStart: [
        {
          id: "bts-executor",
          agent: "executor",
          instruction: "실행 순서를 짧게 고정하고 검증 포인트를 함께 제시한다.",
          enabled: true
        },
        {
          id: "bts-qa-sentinel",
          agent: "qa_sentinel",
          instruction: "회귀 위험과 테스트 누락 가능성을 먼저 확인한다.",
          enabled: true
        }
      ],
      afterTurnCompleted: [
        {
          id: "atc-reviewer",
          agent: "reviewer",
          instruction: "완료 결과를 요구사항/검증항목 기준으로 즉시 리뷰한다.",
          enabled: true
        }
      ],
      onError: [
        {
          id: "oe-debugger",
          agent: "debugger",
          instruction: "실패 원인을 짧게 분류하고 다음 재시도 전략을 남긴다.",
          enabled: true
        }
      ]
    }
  },
  {
    id: "fast-track",
    name: "Fast Track",
    description: "속도 우선 파이프라인",
    injections: {
      beforeDispatch: [
        {
          id: "bd-fast-planner",
          agent: "planner",
          instruction: "핵심 경로만 남기고 부가 작업은 제외한다.",
          enabled: true
        }
      ],
      afterThreadReady: [],
      beforeTurnStart: [
        {
          id: "bts-fast-executor",
          agent: "executor",
          instruction: "결론 중심으로 빠르게 실행한다.",
          enabled: true
        }
      ],
      afterTurnCompleted: [],
      onError: [
        {
          id: "oe-fast-fallback",
          agent: "fallback_router",
          instruction: "실패 시 가장 짧은 차선 경로로 즉시 전환한다.",
          enabled: true
        }
      ]
    }
  },
  {
    id: "qa-hardening",
    name: "QA Hardening",
    description: "품질/안정성 강화 파이프라인",
    injections: {
      beforeDispatch: [
        {
          id: "bd-risk-analyst",
          agent: "risk_analyst",
          instruction: "변경으로 인한 회귀 가능 지점을 먼저 나열한다.",
          enabled: true
        }
      ],
      afterThreadReady: [
        {
          id: "atr-policy-keeper",
          agent: "policy_keeper",
          instruction: "스레드 전반에 동일한 품질 규칙을 고정한다.",
          enabled: true
        }
      ],
      beforeTurnStart: [
        {
          id: "bts-test-designer",
          agent: "test_designer",
          instruction: "검증 절차와 실패 기준을 명시한다.",
          enabled: true
        }
      ],
      afterTurnCompleted: [
        {
          id: "atc-regression-reviewer",
          agent: "regression_reviewer",
          instruction: "회귀 관점에서 결과를 재검토하고 누락 테스트를 적는다.",
          enabled: true
        }
      ],
      onError: [
        {
          id: "oe-incident-logger",
          agent: "incident_logger",
          instruction: "실패 조건, 재현 경로, 재시도 방안을 기록한다.",
          enabled: true
        }
      ]
    }
  }
];
