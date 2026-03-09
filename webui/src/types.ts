export type TransportMode = "simulation" | "connecting" | "live" | "error";

export type LogKind = "system" | "user" | "error";

export interface LogEntry {
  id: string;
  channel: string;
  text: string;
  kind: LogKind;
  timestamp: string;
}

export interface EventEntry {
  id: string;
  tag: string;
  text: string;
  timestamp: string;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
  method: string;
}

export interface TransportState {
  mode: TransportMode;
  endpoint: string;
  socket: WebSocket | null;
  connected: boolean;
  initialized: boolean;
  manualClose: boolean;
  nextId: number;
  pending: Map<number, PendingRequest>;
}

export type HookStage =
  | "beforeDispatch"
  | "afterThreadReady"
  | "beforeTurnStart"
  | "afterTurnCompleted"
  | "onError";

export interface AgentInjection {
  id: string;
  agent: string;
  instruction: string;
  enabled: boolean;
}

export type WorkflowInjections = Record<HookStage, AgentInjection[]>;

export interface StageDefinition {
  key: HookStage;
  title: string;
  description: string;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  injections: WorkflowInjections;
}

export interface LocationSeed {
  id: string;
  name: string;
  cwd: string;
}

export interface LocationState {
  id: string;
  name: string;
  cwd: string;
  paused: boolean;
  running: boolean;
  queue: number;
  threadId: string | null;
  activeTurnId: string | null;
  workflowId: string;
  simTimers: number[];
}

export interface AppState {
  selectedLocationId: string;
  selectedWorkflowId: string;
  logs: LogEntry[];
  events: EventEntry[];
  globalActiveRuns: number;
  transport: TransportState;
}

export interface DomRefs {
  outputEl: HTMLDivElement;
  eventListEl: HTMLUListElement;
  locationListEl: HTMLDivElement;
  locationSelectEl: HTMLSelectElement;
  workflowSelectEl: HTMLSelectElement;
  workflowNameInputEl: HTMLInputElement;
  workflowDescInputEl: HTMLInputElement;
  stageEditorGridEl: HTMLDivElement;
  saveWorkflowBtnEl: HTMLButtonElement;
  duplicateWorkflowBtnEl: HTMLButtonElement;
  resetWorkflowBtnEl: HTMLButtonElement;
  commandFormEl: HTMLFormElement;
  commandInputEl: HTMLInputElement;
  clearLogsBtnEl: HTMLButtonElement;
  globalStatusEl: HTMLSpanElement;
  routeTargetEl: HTMLDivElement;
  transportStatusEl: HTMLSpanElement;
  endpointInputEl: HTMLInputElement;
  connectBtnEl: HTMLButtonElement;
  disconnectBtnEl: HTMLButtonElement;
  locationCardTemplate: HTMLTemplateElement;
  stageCardTemplate: HTMLTemplateElement;
  agentRowTemplate: HTMLTemplateElement;
  logLineTemplate: HTMLTemplateElement;
  eventItemTemplate: HTMLTemplateElement;
}

export interface LogInput {
  channel: string;
  text: string;
  kind?: LogKind;
}

export interface EventInput {
  tag: string;
  text: string;
}

export interface LocationRenderActions {
  onSelect: (locationId: string) => void;
  onNewThread: (locationId: string) => void;
  onTogglePause: (locationId: string) => void;
  onInterrupt: (locationId: string) => void;
}

export interface HookRuntimeContext {
  command: string;
  threadId?: string;
  turnId?: string;
  error?: string;
}
