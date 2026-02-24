import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobAction, JobRecord, JobStatus, TeamRole, TeamTaskAction } from './job.types';
import { JobFileStore, ListJobsOptions } from './storage/job-store';

type TeamTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled';
type TeamRunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'canceled';
type TeamTaskOutput = Record<string, unknown> | null;
type TeamPipelinePhase = 'team-plan' | 'team-prd' | 'team-exec' | 'team-verify' | 'team-fix' | 'complete' | 'failed' | 'cancelled';
type TeamPipelineTransitionEvent =
  | 'plan_ready'
  | 'tasks_started'
  | 'verification_required'
  | 'fix_attempt'
  | 'verification_resumed'
  | 'complete'
  | 'failed'
  | 'cancelled';

interface TeamTaskTemplate {
  id: string;
  name: string;
  role: TeamRole;
  dependencies?: string[];
  maxAttempts?: number;
  timeoutSeconds?: number;
}

interface TeamTaskState extends TeamTaskTemplate {
  status: TeamTaskStatus;
  attempt: number;
  requiresApproval?: boolean;
  startedAt?: string;
  finishedAt?: string;
  workerId?: string;
  claimToken?: string;
  claimExpiresAt?: string;
  lastHeartbeatAt?: string;
  error?: string | null;
  output?: TeamTaskOutput;
}

interface TeamRunState {
  status: TeamRunStatus;
  phase: string;
  approvalTaskId?: string | null;
  currentTaskId?: string | null;
  fixAttempts: number;
  maxFixAttempts: number;
  parallelTasks: number;
  tasks: TeamTaskState[];
  mailbox?: TeamMailboxMessage[];
  pipelinePhase?: TeamPipelinePhase;
  phaseHistory?: TeamPipelinePhaseHistoryEntry[];
  sessionId?: string;
  active?: boolean;
  iteration?: number;
  maxIterations?: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  schemaVersion?: number;
  stateVersion?: number;
  execution?: TeamPipelineExecution;
  fixLoop?: TeamFixLoop;
  cancel?: TeamCancelPolicy;
}

interface TeamPipelinePhaseHistoryEntry {
  phase: TeamPipelinePhase;
  enteredAt: string;
  reason?: string;
}

interface TeamPipelineExecution {
  workersTotal: number;
  workersActive: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  lastFailureReason?: string | null;
}

interface TeamFixLoop {
  attempt: number;
  maxAttempts: number;
  lastFailureReason?: string | null;
}

interface TeamCancelPolicy {
  requested: boolean;
  requestedAt?: string | null | undefined;
  preserveForResume: boolean;
}

type TeamMailboxKind = 'question' | 'instruction' | 'notice' | 'reassign';

interface TeamMailboxMessage {
  id: string;
  kind: TeamMailboxKind;
  to?: TeamRole | TeamRole[] | 'leader';
  taskId?: string;
  message: string;
  payload?: TeamTaskOutput;
  createdAt: string;
  deliveredAt?: string | null;
  delivered: boolean;
  sequence?: number;
  meta?: Record<string, unknown>;
}

interface TeamTaskMetrics {
  total: number;
  queued: number;
  running: number;
  blocked: number;
  succeeded: number;
  failed: number;
  waitingApproval: number;
  canceled: number;
  terminal: number;
  activeWorkers: number;
  averageDurationMs: number;
  maxDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface MonitorActiveAgent {
  jobId: string;
  taskId: string;
  role: TeamRole;
  workerId: string | null;
  status: TeamTaskStatus;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  claimExpiresAt: string | null;
}

export interface MonitorActiveJob {
  id: string;
  provider: JobRecord['provider'];
  mode: JobRecord['mode'];
  status: JobRecord['status'];
  task: string;
  repo: string;
  ref: string;
  startedAt?: string;
  updatedAt: string;
  teamPhase?: string;
  teamMetrics?: TeamTaskMetrics;
}

export interface MonitorOverview {
  generatedAt: string;
  jobs: Record<JobStatus | 'active' | 'total', number>;
  activeJobs: MonitorActiveJob[];
  activeAgents: MonitorActiveAgent[];
  tokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    jobsWithUsage: number;
    jobsWithoutUsage: number;
  };
}

const TERMINAL_STATUSES: JobStatus[] = ['succeeded', 'failed', 'canceled'];
const TEAM_PIPELINE_PHASES: TeamPipelinePhase[] = [
  'team-plan',
  'team-prd',
  'team-exec',
  'team-verify',
  'team-fix',
  'complete',
  'failed',
  'cancelled',
];
const TEAM_PIPELINE_PHASE_SET = new Set<string>(TEAM_PIPELINE_PHASES);
const TEAM_PIPELINE_INITIAL_PHASE: TeamPipelinePhase = 'team-plan';
const TEAM_PIPELINE_PHASE_EVENT_TRANSITIONS: Record<
  TeamPipelinePhase,
  Partial<Record<TeamPipelineTransitionEvent, TeamPipelinePhase>>
> = {
  'team-plan': {
    plan_ready: 'team-prd',
    tasks_started: 'team-exec',
    cancelled: 'cancelled',
  },
  'team-prd': {
    tasks_started: 'team-exec',
    fix_attempt: 'team-fix',
    verification_required: 'team-verify',
    complete: 'complete',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  'team-exec': {
    tasks_started: 'team-exec',
    verification_required: 'team-verify',
    fix_attempt: 'team-fix',
    complete: 'complete',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  'team-verify': {
    verification_resumed: 'team-exec',
    fix_attempt: 'team-fix',
    complete: 'complete',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  'team-fix': {
    tasks_started: 'team-exec',
    verification_required: 'team-verify',
    complete: 'complete',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  complete: {
    plan_ready: 'team-prd',
    complete: 'complete',
  },
  failed: {
    plan_ready: 'team-prd',
  },
  cancelled: {
    plan_ready: 'team-plan',
    tasks_started: 'team-exec',
  },
};
const TEAM_PIPELINE_STATE_SCHEMA_VERSION = 1;

function getAllowedTeamTransitionEvent(
  state: TeamRunState,
  event?: TeamPipelineTransitionEvent,
): TeamPipelineTransitionEvent | undefined {
  if (!event) {
    return undefined;
  }

  const currentPhase = isTeamPipelinePhase(state.pipelinePhase)
    ? state.pipelinePhase
    : resolveLegacyTeamPipelinePhase(state);
  return TEAM_PIPELINE_PHASE_EVENT_TRANSITIONS[currentPhase]?.[event] ? event : undefined;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function isTeamPipelinePhase(raw: unknown): raw is TeamPipelinePhase {
  return typeof raw === 'string' && TEAM_PIPELINE_PHASE_SET.has(raw);
}

function normalizeNumericValue(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function resolveLegacyTeamPipelinePhase(state: TeamRunState): TeamPipelinePhase {
  if (state.status === 'canceled') {
    return 'cancelled';
  }
  if (state.status === 'succeeded') {
    return 'complete';
  }
  if (state.status === 'failed') {
    return 'failed';
  }
  if (state.status === 'waiting_approval') {
    return 'team-verify';
  }
  if (state.tasks.length === 0) {
    return TEAM_PIPELINE_INITIAL_PHASE;
  }
  if (state.fixAttempts > 0 && state.tasks.some((task) => task.status === 'failed')) {
    return 'team-fix';
  }
  if (state.tasks.some((task) => task.status === 'running' || task.status === 'queued')) {
    return 'team-exec';
  }
  if (state.tasks.every((task) => task.status === 'succeeded')) {
    return 'complete';
  }
  if (state.status === 'queued') {
    return 'team-prd';
  }
  return 'team-exec';
}

function normalizeTeamPipelinePhaseHistory(
  phaseHistory: unknown,
  currentPhase: TeamPipelinePhase,
  nextPhase: TeamPipelinePhase,
  enteredAt: string,
  reason?: string,
): TeamPipelinePhaseHistoryEntry[] {
  const rawEntries = Array.isArray(phaseHistory) ? phaseHistory : [];
  type TeamPipelinePhaseHistoryCandidate = {
    phase?: TeamPipelinePhase;
    enteredAt?: string;
    reason?: string;
  };
  const nextHistory = rawEntries
    .map((entry): TeamPipelinePhaseHistoryCandidate => {
      const value = asRecord(entry);
      const phase = value.phase;
      const enteredAtValue = typeof value.enteredAt === 'string' ? value.enteredAt : undefined;
      const reason = typeof value.reason === 'string' ? value.reason.trim() : undefined;
      return {
        phase: isTeamPipelinePhase(phase) ? phase : undefined,
        enteredAt: enteredAtValue,
        reason,
      };
    })
    .filter(
      (entry): entry is TeamPipelinePhaseHistoryEntry =>
        typeof entry.phase === 'string' &&
        isTeamPipelinePhase(entry.phase) &&
        typeof entry.enteredAt === 'string' &&
        entry.enteredAt.length > 0,
    );

  if (nextHistory.length === 0) {
    return [{ phase: currentPhase, enteredAt }];
  }

  const latest = nextHistory[nextHistory.length - 1];
  if (latest.phase !== nextPhase) {
    return [
      ...nextHistory,
      {
        phase: nextPhase,
        enteredAt,
        reason: reason?.trim(),
      },
    ];
  }
  return nextHistory;
}

function transitionTeamPipelinePhase(
  state: TeamRunState,
  enteredAt: string,
  event?: TeamPipelineTransitionEvent,
  reason?: string,
): TeamRunState {
  const currentPhase = isTeamPipelinePhase(state.pipelinePhase)
    ? state.pipelinePhase
    : TEAM_PIPELINE_INITIAL_PHASE;
  const effectiveReason = reason?.trim() ?? (event ? `event:${event}` : `recomputed:${currentPhase}`);

  if (!event) {
    const fallbackPhase = isTeamPipelinePhase(state.pipelinePhase) ? state.pipelinePhase : resolveLegacyTeamPipelinePhase(state);
    return {
      ...state,
      pipelinePhase: fallbackPhase,
      phaseHistory: normalizeTeamPipelinePhaseHistory(state.phaseHistory, fallbackPhase, fallbackPhase, enteredAt, effectiveReason),
    };
  }

  const targetPhase = TEAM_PIPELINE_PHASE_EVENT_TRANSITIONS[currentPhase]?.[event];
  if (!targetPhase) {
    throw new BadRequestException(`Invalid team pipeline transition '${event}' from phase '${currentPhase}'`);
  }
  if (currentPhase === targetPhase) {
    return {
      ...state,
      phaseHistory: normalizeTeamPipelinePhaseHistory(state.phaseHistory, currentPhase, currentPhase, enteredAt, effectiveReason),
    };
  }

  return {
    ...state,
    pipelinePhase: targetPhase,
    phaseHistory: normalizeTeamPipelinePhaseHistory(state.phaseHistory, currentPhase, targetPhase, enteredAt, effectiveReason),
  };
}

function normalizeTeamExecution(state: TeamRunState): TeamPipelineExecution {
  const failedError = state.tasks.find((task) => task.status === 'failed' && typeof task.error === 'string' && task.error.trim().length > 0)?.error;
  return {
    workersTotal: state.tasks.length,
    workersActive: state.tasks.filter((task) => task.status === 'running' && Boolean(task.workerId)).length,
    tasksTotal: state.tasks.length,
    tasksCompleted: state.tasks.filter((task) => task.status === 'succeeded').length,
    tasksFailed: state.tasks.filter((task) => task.status === 'failed').length,
    lastFailureReason: failedError,
  };
}

function withTeamPipelineMetadata(
  state: TeamRunState,
  sessionId = 'unknown',
  transitionEvent?: TeamPipelineTransitionEvent,
  reason?: string,
): TeamRunState {
  const now = nowIsoString();
  const safeFixAttempts = normalizeNumericValue(state.fixAttempts, 0);
  const safeMaxFixAttempts = normalizeNumericValue(state.maxFixAttempts, 0);
  const safeIteration = normalizeNumericValue(state.iteration, safeFixAttempts + 1);
  const safeMaxIterations = Math.max(1, normalizeNumericValue(state.maxIterations, safeMaxFixAttempts > 0 ? safeMaxFixAttempts : 1));
  const isTerminal = state.status === 'succeeded' || state.status === 'failed' || state.status === 'canceled';
  const transitioned = transitionTeamPipelinePhase(state, now, transitionEvent, reason);
  const failureReason = state.tasks.find((task) => task.status === 'failed' && typeof task.error === 'string')?.error;
  const nextStateVersion = normalizeNumericValue(state.stateVersion, 0);
  const schemaVersion = normalizeNumericValue(state.schemaVersion, TEAM_PIPELINE_STATE_SCHEMA_VERSION);
  const preserveForResume = typeof transitioned.cancel?.preserveForResume === 'boolean'
    ? transitioned.cancel.preserveForResume
    : isTerminal;

  return {
    ...transitioned,
    pipelinePhase: transitioned.pipelinePhase ?? TEAM_PIPELINE_INITIAL_PHASE,
    phaseHistory: normalizeTeamPipelinePhaseHistory(transitioned.phaseHistory, transitioned.pipelinePhase ?? TEAM_PIPELINE_INITIAL_PHASE, transitioned.pipelinePhase ?? TEAM_PIPELINE_INITIAL_PHASE, now),
    sessionId: transitioned.sessionId || sessionId,
    active: !isTerminal,
    iteration: safeIteration,
    maxIterations: safeMaxIterations,
    startedAt: transitioned.startedAt || now,
    updatedAt: now,
    completedAt: isTerminal ? (transitioned.completedAt || now) : null,
    schemaVersion: schemaVersion,
    stateVersion: nextStateVersion,
    execution: normalizeTeamExecution(transitioned),
    fixLoop: {
      attempt: safeFixAttempts,
      maxAttempts: safeMaxFixAttempts,
      lastFailureReason: failureReason ?? null,
    },
    cancel: {
      requested: transitioned.status === 'canceled' ? true : Boolean(transitioned.cancel?.requested),
      requestedAt:
        transitioned.status === 'canceled'
          ? (transitioned.cancel?.requestedAt || transitioned.completedAt || now)
          : null,
      preserveForResume,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toTokenNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function pickTokenValue(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const found = toTokenNumber(record[key]);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function extractTokenUsage(value: unknown): TokenUsage | null {
  const root = asRecord(value);
  const candidates = [root, asRecord(root.usage), asRecord(root.token_usage)];

  for (const candidate of candidates) {
    const inputTokens = pickTokenValue(candidate, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input']);
    const outputTokens = pickTokenValue(candidate, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output']);
    let totalTokens = pickTokenValue(candidate, ['total_tokens', 'totalTokens', 'total']);

    if (inputTokens === null && outputTokens === null && totalTokens === null) {
      continue;
    }

    if (totalTokens === null && inputTokens !== null && outputTokens !== null) {
      totalTokens = inputTokens + outputTokens;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
    };
  }

  return null;
}

function normalizeDependencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

function normalizeTeamTaskTemplateSource(teamOptions: Record<string, unknown>): Array<Record<string, unknown>> {
  const preferred = teamOptions.teamTasks;
  if (Array.isArray(preferred)) {
    return preferred.filter(
      (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
    ) as Array<Record<string, unknown>>;
  }

  const legacy = teamOptions.taskTemplates;
  if (Array.isArray(legacy)) {
    return legacy.filter(
      (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
    ) as Array<Record<string, unknown>>;
  }

  return [];
}

function normalizeTeamRole(role: unknown): TeamRole | null {
  if (
    role === 'planner' ||
    role === 'researcher' ||
    role === 'designer' ||
    role === 'developer' ||
    role === 'executor' ||
    role === 'verifier'
  ) {
    return role;
  }
  return null;
}

function randomMailboxMessageId(): string {
  return `mailbox-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeTeamMailboxMessage(raw: unknown, defaultIdx: number): TeamMailboxMessage | null {
  const item = asRecord(raw);
  const kindCandidate = item.kind;
  const message = typeof item.message === 'string' && item.message.trim() ? item.message.trim() : '';
  if (!message) {
    return null;
  }

  const kind = typeof kindCandidate === 'string' ? kindCandidate : '';
  if (!['question', 'instruction', 'notice', 'reassign'].includes(kind)) {
    return null;
  }

  const toCandidate = item.to;
  const to =
    toCandidate === 'leader'
      ? 'leader'
      : normalizeTeamRole(toCandidate)
        ? (normalizeTeamRole(toCandidate) as TeamRole)
        : Array.isArray(toCandidate) &&
            toCandidate.every((entry) => normalizeTeamRole(entry) === entry)
          ? (toCandidate as TeamRole[])
          : undefined;

  const taskId = typeof item.taskId === 'string' && item.taskId.trim() ? item.taskId.trim() : undefined;
  const sequence = typeof item.sequence === 'number' && Number.isFinite(item.sequence) ? Math.floor(item.sequence) : undefined;
  return {
    id:
      typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${kind}-${Date.now().toString(36)}-${defaultIdx}`,
    kind: kind as TeamMailboxKind,
    to,
    taskId,
    message,
    payload: asRecord(item.payload),
    createdAt: typeof item.createdAt === 'string' && item.createdAt.trim() ? item.createdAt : new Date().toISOString(),
    deliveredAt: typeof item.deliveredAt === 'string' && item.deliveredAt.trim() ? item.deliveredAt : null,
    delivered: typeof item.delivered === 'boolean' ? item.delivered : false,
    sequence: sequence === undefined || Number.isNaN(sequence) ? undefined : Math.max(0, sequence),
    meta: asRecord(item.meta),
  };
}

function normalizeTeamMailbox(raw: unknown): TeamMailboxMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized = raw
    .map((item, idx) => normalizeTeamMailboxMessage(item, idx))
    .filter((message): message is TeamMailboxMessage => message !== null)
    .map((message, idx) => ({
      ...message,
      sequence: typeof message.sequence === 'number' && Number.isFinite(message.sequence) ? Math.max(0, Math.floor(message.sequence)) : idx + 1,
    }))
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? -1 : 1;
      }
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });

  return normalized;
}

function normalizeTaskTemplates(templates?: Array<Record<string, unknown>>): TeamTaskState[] {
  const normalized = (templates ?? [])
    .map((raw, index) => {
      const source = asRecord(raw);
      const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : `Task ${index + 1}`;
      const role = normalizeTeamRole(source.role);
      if (!role) {
        return null;
      }

      const id = typeof source.id === 'string' && source.id.trim().length > 0 ? source.id : `${role}-${index + 1}`;
      const maxAttempts = typeof source.maxAttempts === 'number' && source.maxAttempts > 0 ? Math.floor(source.maxAttempts) : 1;
      const timeoutSeconds =
        typeof source.timeoutSeconds === 'number' && source.timeoutSeconds > 0 ? Math.floor(source.timeoutSeconds) : 900;
      const dependencies = normalizeDependencies(source.dependencies);

      return {
        id,
        name,
        role,
        dependencies,
        maxAttempts,
        timeoutSeconds,
        status: dependencies.length === 0 ? ('queued' as TeamTaskStatus) : ('blocked' as TeamTaskStatus),
        attempt: 0,
      } as TeamTaskState;
    })
    .filter((item): item is TeamTaskState => item !== null);

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      id: 'team-planner',
      name: 'Create execution plan',
      role: 'planner',
      dependencies: [],
      maxAttempts: 1,
      timeoutSeconds: 1200,
      status: 'queued',
      attempt: 0,
    },
    {
      id: 'team-research',
      name: 'Gather context and references',
      role: 'researcher',
      dependencies: ['team-planner'],
      maxAttempts: 1,
      timeoutSeconds: 1200,
      status: 'blocked',
      attempt: 0,
    },
    {
      id: 'team-designer',
      name: 'Propose solution design',
      role: 'designer',
      dependencies: ['team-planner'],
      maxAttempts: 1,
      timeoutSeconds: 1200,
      status: 'blocked',
      attempt: 0,
    },
    {
      id: 'team-developer',
      name: 'Implement requested changes',
      role: 'developer',
      dependencies: ['team-designer', 'team-research'],
      maxAttempts: 2,
      timeoutSeconds: 3600,
      status: 'blocked',
      attempt: 0,
    },
    {
      id: 'team-executor',
      name: 'Run implementation tasks',
      role: 'executor',
      dependencies: ['team-developer'],
      maxAttempts: 1,
      timeoutSeconds: 1200,
      status: 'blocked',
      attempt: 0,
    },
    {
      id: 'team-verifier',
      name: 'Verify results',
      role: 'verifier',
      dependencies: ['team-executor'],
      maxAttempts: 1,
      timeoutSeconds: 1200,
      status: 'blocked',
      attempt: 0,
    },
  ];
}

function buildTeamTaskMetrics(tasks: TeamTaskState[]): TeamTaskMetrics {
  const total = tasks.length;
  const queued = tasks.filter((task) => task.status === 'queued').length;
  const running = tasks.filter((task) => task.status === 'running').length;
  const blocked = tasks.filter((task) => task.status === 'blocked').length;
  const succeeded = tasks.filter((task) => task.status === 'succeeded').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  const waitingApproval = tasks.filter((task) => Boolean(task.requiresApproval)).length;
  const canceled = tasks.filter((task) => task.status === 'canceled').length;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  const durationsMs = tasks.reduce((sum, task) => {
    if (!task.startedAt || !task.finishedAt) {
      return sum;
    }

    const start = Date.parse(task.startedAt);
    const end = Date.parse(task.finishedAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return sum;
    }

    return sum + (end - start);
  }, 0);
  const completedWithDuration = tasks.filter((task) => {
    if (!task.startedAt || !task.finishedAt) {
      return false;
    }

    const start = Date.parse(task.startedAt);
    const end = Date.parse(task.finishedAt);
    return !Number.isNaN(start) && !Number.isNaN(end) && end >= start;
  }).length;
  const maxDuration = tasks.reduce((nextMax, task) => {
    if (!task.startedAt || !task.finishedAt) {
      return nextMax;
    }

    const start = Date.parse(task.startedAt);
    const end = Date.parse(task.finishedAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return nextMax;
    }

    return Math.max(nextMax, end - start);
  }, 0);
  const averageDurationMs = completedWithDuration > 0 ? Math.round(durationsMs / completedWithDuration) : 0;
  for (const task of tasks) {
    const usage = extractTokenUsage(task.output);
    if (!usage) {
      continue;
    }

    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    totalTokens += usage.totalTokens ?? 0;
  }

  return {
    total,
    queued,
    running,
    blocked,
    succeeded,
    failed,
    waitingApproval,
    canceled,
    terminal: succeeded + failed + canceled,
    activeWorkers: tasks.filter((task) => task.status === 'running' && Boolean(task.workerId)).length,
    averageDurationMs,
    maxDurationMs: maxDuration,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function defaultTeamState(rawState?: Record<string, unknown>): TeamRunState {
  const state = asRecord(rawState);
  const maxFixAttempts = typeof state.maxFixAttempts === 'number' && state.maxFixAttempts >= 0 ? Math.floor(state.maxFixAttempts) : 2;
  const parallelTasks =
    typeof state.parallelTasks === 'number' && state.parallelTasks >= 1 ? Math.max(1, Math.floor(state.parallelTasks)) : 1;
  const taskTemplates = normalizeTeamTaskTemplateSource(state);
  const taskSeed = normalizeTaskTemplates(taskTemplates);

  const phase = typeof state.phase === 'string' && state.phase.trim() ? state.phase : 'planning';
  const startedAt = typeof state.startedAt === 'string' && state.startedAt.trim() ? state.startedAt : nowIsoString();
  const base: TeamRunState = {
    status: 'queued',
    phase,
    fixAttempts: 0,
    maxFixAttempts,
    parallelTasks,
    currentTaskId: null,
    mailbox: [],
    tasks: taskSeed,
    sessionId: typeof state.sessionId === 'string' && state.sessionId.trim() ? state.sessionId : 'legacy',
    active: true,
    iteration: 1,
    maxIterations: maxFixAttempts > 0 ? maxFixAttempts : 1,
    startedAt,
    updatedAt: nowIsoString(),
    completedAt: null,
    execution: {
      workersTotal: taskSeed.length,
      workersActive: 0,
      tasksTotal: taskSeed.length,
      tasksCompleted: 0,
      tasksFailed: 0,
    },
    schemaVersion: TEAM_PIPELINE_STATE_SCHEMA_VERSION,
    stateVersion: 1,
    fixLoop: {
      attempt: 0,
      maxAttempts: Math.max(1, maxFixAttempts),
      lastFailureReason: null,
    },
    cancel: {
      requested: false,
      preserveForResume: true,
    },
    pipelinePhase: TEAM_PIPELINE_INITIAL_PHASE,
    phaseHistory: [{ phase: TEAM_PIPELINE_INITIAL_PHASE, enteredAt: startedAt }],
  };
  return withTeamPipelineMetadata(base, base.sessionId);
}

function toTeamTaskPhase(tasks: TeamTaskState[]): string {
  const firstQueued = tasks.find((task) => task.status === 'queued');
  if (firstQueued) {
    return firstQueued.role;
  }

  const running = tasks.find((task) => task.status === 'running');
  if (running) {
    return running.role;
  }

  const failed = tasks.find((task) => task.status === 'failed');
  if (failed) {
    return `retry_${failed.role}`;
  }

  const blocked = tasks.find((task) => task.status === 'blocked');
  if (blocked) {
    return blocked.role;
  }

  return tasks.every((task) => task.status === 'succeeded') ? 'completed' : 'blocked';
}

function isTaskDependenciesSatisfied(task: TeamTaskState, tasks: TeamTaskState[]): boolean {
  if (!task.dependencies || task.dependencies.length === 0) {
    return true;
  }

  const byId = new Map(tasks.map((item) => [item.id, item]));
  return task.dependencies.every((id) => {
    const dependency = byId.get(id);
    return dependency?.status === 'succeeded';
  });
}

@Injectable()
export class JobsService {
  private readonly store = new JobFileStore();

  constructor(private readonly queue: QueueService) {}

  async createJob(dto: CreateJobDto) {
    const approvalState: JobRecord['approvalState'] = dto.options?.requireApproval ? 'required' : 'none';
    const options: Record<string, unknown> = asRecord(dto.options);
    const isSearchMode = options.searchMode === true;
    const repoInput = typeof dto.repo === 'string' ? dto.repo.trim() : '';
    const refInput = typeof dto.ref === 'string' ? dto.ref.trim() : '';
    const repo = isSearchMode ? (repoInput || 'search://local') : (repoInput || dto.repo);
    const ref = isSearchMode ? (refInput || 'main') : (refInput || dto.ref);

    if (dto.mode === 'team' && !asRecord(options.team).state) {
      options.team = {
        ...asRecord(options.team),
        state: defaultTeamState(asRecord(options.team)),
      };
    }

    const created = await this.store.createJob(
      {
        ...dto,
        repo,
        ref,
        options,
      },
      approvalState,
    );
    await this.addEvent(created.id, 'queued', 'Job queued');
    await this.queue.enqueueJob(created.id);
    return created;
  }

  async getJob(jobId: string): Promise<JobRecord> {
    const job = await this.store.findJobById(jobId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    return job;
  }

  async listJobs(options: ListJobsOptions = {}): Promise<JobRecord[]> {
    return this.store.listJobs(options);
  }

  async getTeamState(jobId: string): Promise<Record<string, unknown>> {
    const job = await this.getJob(jobId);
    if (job.mode !== 'team') {
      throw new BadRequestException('not a team job');
    }

    const state = this.extractJobTeamState(job);
    const normalizedMailbox = normalizeTeamMailbox(state.mailbox);
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    return {
      ...state,
      mailbox: normalizedMailbox,
      metrics: buildTeamTaskMetrics(tasks),
    } as Record<string, unknown>;
  }

  async getTeamMailbox(jobId: string, after?: number | string): Promise<TeamMailboxMessage[]> {
    const job = await this.getJob(jobId);
    if (job.mode !== 'team') {
      throw new BadRequestException('not a team job');
    }

    const state = this.extractJobTeamState(job);
    const normalizedMailbox = normalizeTeamMailbox(state.mailbox);
    const normalizedAfter = (() => {
      if (typeof after === 'number' && Number.isFinite(after)) {
        return Math.max(0, Math.floor(after));
      }
      if (typeof after === 'string' && after.trim().length > 0) {
        const parsed = Number(after);
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.floor(parsed));
        }
      }
      return undefined;
    })();

    if (typeof normalizedAfter !== 'number') {
      return normalizedMailbox;
    }

    return normalizedMailbox.filter((message) => typeof message.sequence === 'number' && message.sequence > normalizedAfter);
  }

  async sendTeamMailboxMessage(jobId: string, message: Record<string, unknown>): Promise<TeamMailboxMessage> {
    const job = await this.getJob(jobId);
    if (job.mode !== 'team') {
      throw new BadRequestException('not a team job');
    }

    const currentState = this.extractJobTeamState(job);
    const mailbox = normalizeTeamMailbox(currentState.mailbox);
    const normalized = normalizeTeamMailboxMessage(message, mailbox.length);
    if (!normalized) {
      throw new BadRequestException('Invalid mailbox message payload');
    }

    const nextSequence = mailbox.reduce((next, entry) => {
      const candidate = typeof entry.sequence === 'number' && Number.isFinite(entry.sequence) ? entry.sequence : -1;
      return candidate > next ? candidate : next;
    }, 0) + 1;

    const nextMessage: TeamMailboxMessage = {
      ...normalized,
      id: normalized.id || randomMailboxMessageId(),
      sequence: typeof normalized.sequence === 'number'
        ? Math.max(0, Math.floor(normalized.sequence))
        : nextSequence,
      delivered: false,
      deliveredAt: null,
    };

    const nextState: TeamRunState = {
      ...currentState,
      mailbox: [
        ...mailbox,
        nextMessage,
      ],
    };

    await this.persistTeamState(jobId, nextState);
    await this.addEvent(jobId, 'team.mailbox.received', `Mailbox message received for task ${normalized.taskId ?? 'none'}`, {
      taskId: normalized.taskId,
      kind: normalized.kind,
      to: normalized.to,
      message: normalized.message,
    });
    return nextMessage;
  }

  async listRecentEvents(jobId: string, take = 100) {
    await this.getJob(jobId);
    return this.store.listRecentEvents(jobId, take);
  }

  async getMonitorOverview(limit = 200): Promise<MonitorOverview> {
    const safeLimit = Math.max(1, Math.min(2000, Math.floor(limit || 200)));
    const jobs = await this.listJobs({ limit: safeLimit });
    const activeStatuses: JobStatus[] = ['queued', 'running', 'waiting_approval'];

    const counters = {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
      waiting_approval: jobs.filter((job) => job.status === 'waiting_approval').length,
      succeeded: jobs.filter((job) => job.status === 'succeeded').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      canceled: jobs.filter((job) => job.status === 'canceled').length,
      active: jobs.filter((job) => activeStatuses.includes(job.status)).length,
    };

    const activeJobs: MonitorActiveJob[] = [];
    const activeAgents: MonitorActiveAgent[] = [];

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let jobsWithUsage = 0;
    let jobsWithoutUsage = 0;

    for (const job of jobs) {
      const usage = this.collectJobTokenUsage(job);
      if (usage) {
        jobsWithUsage += 1;
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        totalTokens += usage.totalTokens ?? 0;
      } else {
        jobsWithoutUsage += 1;
      }

      if (!activeStatuses.includes(job.status)) {
        continue;
      }

      if (job.mode === 'team') {
        const teamState = this.extractJobTeamState(job);
        const metrics = buildTeamTaskMetrics(teamState.tasks);
        activeJobs.push({
          id: job.id,
          provider: job.provider,
          mode: job.mode,
          status: job.status,
          task: job.task,
          repo: job.repo,
          ref: job.ref,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
          teamPhase: teamState.phase,
          teamMetrics: metrics,
        });

        for (const task of teamState.tasks) {
          if (task.status !== 'running' && !task.workerId) {
            continue;
          }
          activeAgents.push({
            jobId: job.id,
            taskId: task.id,
            role: task.role,
            workerId: task.workerId ?? null,
            status: task.status,
            startedAt: task.startedAt ?? null,
            lastHeartbeatAt: task.lastHeartbeatAt ?? null,
            claimExpiresAt: task.claimExpiresAt ?? null,
          });
        }
      } else {
        activeJobs.push({
          id: job.id,
          provider: job.provider,
          mode: job.mode,
          status: job.status,
          task: job.task,
          repo: job.repo,
          ref: job.ref,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      jobs: counters,
      activeJobs,
      activeAgents,
      tokens: {
        inputTokens,
        outputTokens,
        totalTokens,
        jobsWithUsage,
        jobsWithoutUsage,
      },
    };
  }

  async applyAction(jobId: string, action: JobAction): Promise<JobRecord> {
    const current = await this.getJob(jobId);
    const jobOptions = asRecord(current.options);
    const team = asRecord(jobOptions.team);
    const extractedTeamState = current.mode === 'team' ? this.extractJobTeamState(current) : undefined;

    if (action === 'cancel') {
      if (TERMINAL_STATUSES.includes(current.status)) {
        throw new ConflictException('Job is already in a terminal state');
      }

      if (current.mode === 'team') {
        const preserveForResume = typeof extractedTeamState?.cancel?.preserveForResume === 'boolean'
          ? extractedTeamState.cancel.preserveForResume
          : true;
        const nextTeamState = withTeamPipelineMetadata(
          {
            ...(extractedTeamState ?? defaultTeamState(team)),
            status: 'canceled',
            approvalTaskId: null,
            currentTaskId: null,
            cancel: {
              requested: true,
              requestedAt: new Date().toISOString(),
              preserveForResume,
            },
          },
          jobId,
          'cancelled',
          'action.cancel',
        );
        await this.persistTeamState(jobId, nextTeamState);
      }

      const updated = await this.store.updateJob(jobId, {
        status: 'canceled',
        finishedAt: new Date().toISOString(),
      });
      await this.addEvent(jobId, 'canceled', 'Job canceled by user');
      return updated;
    }

    if (action === 'resume') {
      if (!TERMINAL_STATUSES.includes(current.status) && current.status !== 'waiting_approval') {
        throw new ConflictException('Only terminal or approval-pending jobs can be resumed');
      }

      if (
        current.status === 'canceled'
        && extractedTeamState?.cancel?.requested === true
        && extractedTeamState.cancel.preserveForResume === false
      ) {
        throw new ConflictException('Resume is blocked because preserveForResume is false');
      }

      const jobOptions = asRecord(current.options);
      const team = asRecord(jobOptions.team);
      const baseTeamState = extractedTeamState ?? defaultTeamState(team);
      const nextState =
          current.mode === 'team'
          ? withTeamPipelineMetadata(
              {
                ...baseTeamState,
                status: 'queued',
                approvalTaskId: null,
                currentTaskId: null,
                cancel: {
                  requested: false,
                  requestedAt: null,
                  preserveForResume: typeof extractedTeamState?.cancel?.preserveForResume === 'boolean'
                    ? extractedTeamState.cancel.preserveForResume
                  : true,
                },
              },
              jobId,
              getAllowedTeamTransitionEvent(baseTeamState, 'plan_ready'),
              'action.resume',
            )
          : undefined;

      const updated = await this.store.updateJob(jobId, {
        status: 'queued',
        approvalState: current.approvalState === 'required' ? 'approved' : current.approvalState,
        error: null,
        options:
          current.mode === 'team'
            ? ({ ...jobOptions, team: { ...team, state: nextState } }) as Record<string, unknown>
            : (jobOptions as Record<string, unknown>),
      });

      await this.addEvent(jobId, 'queued', 'Job resumed by user');
      await this.queue.enqueueJob(jobId);
      return updated;
    }

    if (current.status !== 'waiting_approval' || current.approvalState !== 'required') {
      throw new ConflictException('Job is not waiting for approval');
    }

    if (action === 'approve') {
      const resumedState =
        current.mode === 'team'
          ? withTeamPipelineMetadata(
              {
                ...(extractedTeamState ?? defaultTeamState(team)),
                status: 'queued',
                approvalTaskId: null,
                currentTaskId: null,
                cancel: {
                  requested: false,
                  requestedAt: null,
                  preserveForResume: typeof extractedTeamState?.cancel?.preserveForResume === 'boolean'
                    ? extractedTeamState.cancel.preserveForResume
                    : true,
                },
              },
              jobId,
              getAllowedTeamTransitionEvent(extractedTeamState ?? defaultTeamState(team), 'verification_resumed'),
              'action.approve',
            )
          : undefined;

      const nextOptions =
        current.mode === 'team'
          ? ({
              ...jobOptions,
              team: {
                ...team,
                state: resumedState,
              },
            } as Record<string, unknown>)
          : jobOptions;
      const updated = await this.store.updateJob(jobId, {
        approvalState: 'approved',
        status: 'queued',
        error: null,
        options: current.mode === 'team' ? nextOptions : jobOptions,
      });
      await this.addEvent(jobId, 'approval', 'Approval granted, re-queued');
      await this.queue.enqueueJob(jobId);
      return updated;
    }

    const updated = await this.store.updateJob(jobId, {
      approvalState: 'rejected',
      status: 'failed',
      error: 'Rejected by approver',
      finishedAt: new Date().toISOString(),
    });
    await this.addEvent(jobId, 'approval', 'Approval rejected');
    if (current.mode === 'team') {
      await this.rewindTeamStateForApproval(
        jobId,
        current.mode === 'team' ? this.extractJobTeamState(current) : undefined,
      );
    }
    return updated;
  }

  async applyTaskAction(jobId: string, taskId: string, action: TeamTaskAction): Promise<JobRecord> {
    const current = await this.getJob(jobId);
    if (current.mode !== 'team') {
      throw new BadRequestException('Task actions are only supported for team jobs');
    }

    const teamState = this.extractJobTeamState(current);
    const targetTask = teamState.tasks.find((task) => task.id === taskId);
    if (!targetTask) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    if (current.status !== 'waiting_approval' || current.approvalState !== 'required' || !targetTask.requiresApproval) {
      throw new ConflictException('Task is not waiting for approval');
    }

    const approvalTaskId = typeof teamState.approvalTaskId === 'string' && teamState.approvalTaskId.trim().length > 0
      ? teamState.approvalTaskId
      : null;
    if (approvalTaskId && approvalTaskId !== taskId) {
      throw new ConflictException('Task is not currently awaiting approval');
    }

    await this.updateTeamTaskState(
      jobId,
      (state) => ({
        ...state,
        approvalTaskId: null,
        status: action === 'approve' ? 'queued' : 'failed',
        currentTaskId: null,
        tasks: state.tasks.map((task) => {
          if (task.id !== taskId) {
            return task;
          }

          if (action === 'approve') {
            return {
              ...task,
              requiresApproval: false,
              status: task.status === 'failed' || task.status === 'canceled' ? 'queued' : ('queued' as TeamTaskStatus),
              error: undefined,
            };
          }

          return {
            ...task,
            requiresApproval: false,
            status: 'failed' as TeamTaskStatus,
            error: 'Task output rejected by approver',
            finishedAt: new Date().toISOString(),
          };
        }),
      }),
      action === 'approve'
        ? getAllowedTeamTransitionEvent(teamState, 'verification_resumed')
        : getAllowedTeamTransitionEvent(teamState, 'failed'),
    );

    if (action === 'approve') {
      const updated = await this.store.updateJob(jobId, {
        approvalState: 'approved',
        status: 'queued',
        error: null,
      });
      await this.addEvent(jobId, 'approval', 'Task approval granted; rerun queued');
      await this.queue.enqueueJob(jobId);
      return updated;
    }

    const updated = await this.store.updateJob(jobId, {
      approvalState: 'rejected',
      status: 'failed',
      error: 'Rejected by approver',
      finishedAt: new Date().toISOString(),
    });
    await this.addEvent(jobId, 'approval', `Task approval rejected: ${taskId}`);
    return updated;
  }

  async rewindTeamStateForApproval(jobId: string, currentState?: TeamRunState) {
    if (!currentState) {
      return;
    }

    const rewoundTasks = currentState.tasks.map((task) => {
      const blocked = task.status === 'blocked' ? 'blocked' : task.status;
      return {
        ...task,
        status: blocked,
      };
    });

    const updatedState = {
      ...currentState,
      status: 'waiting_approval' as TeamRunStatus,
      approvalTaskId: null,
      tasks: rewoundTasks,
      currentTaskId: null,
    } as TeamRunState;

    await this.persistTeamState(
      jobId,
      withTeamPipelineMetadata(
        updatedState,
        jobId,
        getAllowedTeamTransitionEvent(currentState, 'verification_required'),
        'rewind-for-approval',
      ),
    );
  }

  async persistTeamState(
    jobId: string,
    nextState: TeamRunState,
    transitionEvent?: TeamPipelineTransitionEvent,
    reason?: string,
    expectedStateVersion?: number,
  ) {
    const job = await this.getJob(jobId);
    const options = asRecord(job.options);
    const team = asRecord(options.team);
    const previousStateVersion = normalizeNumericValue(asRecord(team.state).stateVersion, 0);
    const normalizedExpectedStateVersion = typeof expectedStateVersion === 'number' ? Math.max(0, Math.floor(expectedStateVersion)) : undefined;
    if (typeof normalizedExpectedStateVersion === 'number' && previousStateVersion !== normalizedExpectedStateVersion) {
      throw new ConflictException(
        `Team state version mismatch: expected ${normalizedExpectedStateVersion}, current ${previousStateVersion}`,
      );
    }
    const mergedState = withTeamPipelineMetadata(nextState, jobId, transitionEvent, reason);
    const normalizedNextStateVersion = normalizeNumericValue(mergedState.stateVersion, previousStateVersion);
    const merged = {
      ...options,
      team: {
        ...team,
        state: {
          ...mergedState,
          schemaVersion: TEAM_PIPELINE_STATE_SCHEMA_VERSION,
          stateVersion: normalizedNextStateVersion + 1,
        } as Record<string, unknown>,
      },
    };
    await this.store.updateJob(jobId, { options: merged as Record<string, unknown> });
  }

  extractJobTeamState(job: { options: unknown; id?: string }): TeamRunState {
    const options = asRecord(job.options);
    const team = asRecord(options.team);
    const state = asRecord(team.state);
    const base = defaultTeamState(team as Record<string, unknown>);
    return withTeamPipelineMetadata({
      ...base,
      ...state,
      mailbox: normalizeTeamMailbox(state.mailbox),
      tasks: Array.isArray(state.tasks) ? (state.tasks as TeamTaskState[]) : base.tasks,
    }, typeof job.id === 'string' && job.id.trim() ? job.id : 'legacy');
  }

  async updateTeamTaskState(
    jobId: string,
    updater: (state: TeamRunState) => TeamRunState,
    transitionEvent?: TeamPipelineTransitionEvent,
  ): Promise<TeamRunState> {
    const job = await this.getJob(jobId);
    if (job.mode !== 'team') {
      return defaultTeamState(asRecord(asRecord(job.options).team));
    }

    const options = asRecord(job.options);
    const team = asRecord(options.team);
    const current = asRecord(team.state);
    const taskSeed = Array.isArray(current.tasks) ? (current.tasks as TeamTaskState[]) : [];
    const state: TeamRunState =
      taskSeed.length > 0
        ? ({ ...defaultTeamState(team), ...current, tasks: taskSeed } as TeamRunState)
        : defaultTeamState(team);
    state.mailbox = normalizeTeamMailbox(current.mailbox);
    const next = updater({
      ...state,
      phase: toTeamTaskPhase(state.tasks),
    });
    next.phase = toTeamTaskPhase(next.tasks);
    const normalized = withTeamPipelineMetadata({
      ...next,
      tasks: next.tasks.map((task) => {
        const depsSatisfied = task.status !== 'queued' ? false : isTaskDependenciesSatisfied(task, next.tasks);
        return {
          ...task,
          status: task.status === 'blocked' && depsSatisfied ? ('queued' as TeamTaskStatus) : task.status,
          output:
            task.output && typeof task.output === 'object' ? (task.output as TeamTaskOutput) : undefined,
          attempt: task.attempt,
        };
      }),
    }, jobId, transitionEvent, 'state.task_update');

    await this.persistTeamState(jobId, normalized);
    return normalized;
  }

  async addEvent(jobId: string, type: string, message: string, payload?: Record<string, unknown>) {
    await this.store.addEvent(jobId, type, message, payload);
  }

  private collectJobTokenUsage(job: JobRecord): TokenUsage | null {
    if (job.mode === 'team') {
      const state = this.extractJobTeamState(job);
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let hasUsage = false;

      for (const task of state.tasks) {
        const output = asRecord(task.output);
        const parsed = output.parsed;
        const usage = extractTokenUsage(parsed);
        if (!usage) {
          continue;
        }
        hasUsage = true;
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        totalTokens += usage.totalTokens ?? 0;
      }

      if (!hasUsage) {
        return null;
      }

      return {
        inputTokens,
        outputTokens,
        totalTokens,
      };
    }

    const output = asRecord(job.output);
    const directUsage = extractTokenUsage(output);
    if (directUsage) {
      return directUsage;
    }

    const parsedUsage = extractTokenUsage(output.parsed);
    if (parsedUsage) {
      return parsedUsage;
    }

    return null;
  }
}
