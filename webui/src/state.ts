import { DEFAULT_ENDPOINT, DEFAULT_WORKFLOW_ID, DEFAULT_WORKFLOWS, LOCATION_SEEDS } from "./config.js";
import type {
  AgentInjection,
  AppState,
  HookStage,
  LocationState,
  WorkflowPreset,
  WorkflowInjections
} from "./types.js";

function cloneInjections(injections: WorkflowInjections): WorkflowInjections {
  return {
    beforeDispatch: injections.beforeDispatch.map((item) => ({ ...item })),
    afterThreadReady: injections.afterThreadReady.map((item) => ({ ...item })),
    beforeTurnStart: injections.beforeTurnStart.map((item) => ({ ...item })),
    afterTurnCompleted: injections.afterTurnCompleted.map((item) => ({ ...item })),
    onError: injections.onError.map((item) => ({ ...item }))
  };
}

export function cloneWorkflows(items: WorkflowPreset[]): WorkflowPreset[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    injections: cloneInjections(item.injections)
  }));
}

export const locations: LocationState[] = LOCATION_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  cwd: seed.cwd,
  paused: false,
  running: false,
  queue: 0,
  threadId: null,
  activeTurnId: null,
  workflowId: DEFAULT_WORKFLOW_ID,
  simTimers: []
}));

export const workflows: WorkflowPreset[] = cloneWorkflows(DEFAULT_WORKFLOWS);

export const state: AppState = {
  selectedLocationId: locations[0].id,
  selectedWorkflowId: DEFAULT_WORKFLOW_ID,
  logs: [],
  events: [],
  globalActiveRuns: 0,
  transport: {
    mode: "simulation",
    endpoint: DEFAULT_ENDPOINT,
    socket: null,
    connected: false,
    initialized: false,
    manualClose: false,
    nextId: 1,
    pending: new Map()
  }
};

export function findLocation(locationId: string): LocationState | undefined {
  return locations.find((location) => location.id === locationId);
}

export function findLocationByThreadId(threadId: string | null | undefined): LocationState | undefined {
  if (!threadId) {
    return undefined;
  }
  return locations.find((location) => location.threadId === threadId);
}

export function locationFromParams(params: unknown): LocationState | undefined {
  if (!params || typeof params !== "object") {
    return findLocation(state.selectedLocationId);
  }

  const payload = params as {
    threadId?: string;
    thread?: { id?: string };
  };

  const threadId = payload.threadId || payload.thread?.id;
  if (threadId) {
    return findLocationByThreadId(threadId) || findLocation(state.selectedLocationId);
  }

  return findLocation(state.selectedLocationId);
}

export function increaseRunCount(location: LocationState): void {
  location.queue += 1;
  location.running = true;
  state.globalActiveRuns += 1;
}

export function decreaseRunCount(location: LocationState): void {
  if (location.queue > 0) {
    location.queue -= 1;
    state.globalActiveRuns = Math.max(0, state.globalActiveRuns - 1);
  }

  location.running = location.queue > 0;
  if (!location.running) {
    location.activeTurnId = null;
  }
}

export function clearRunCount(location: LocationState): void {
  if (location.queue > 0) {
    state.globalActiveRuns = Math.max(0, state.globalActiveRuns - location.queue);
  }

  location.queue = 0;
  location.running = false;
  location.activeTurnId = null;
}

export function clearSimulationTimers(location: LocationState): void {
  for (const timerId of location.simTimers) {
    window.clearTimeout(timerId);
  }
  location.simTimers = [];
}

export function setSelectedLocationId(locationId: string): void {
  state.selectedLocationId = locationId;
}

export function setSelectedWorkflowId(workflowId: string): void {
  state.selectedWorkflowId = workflowId;
}

export function getWorkflowById(workflowId: string): WorkflowPreset | undefined {
  return workflows.find((workflow) => workflow.id === workflowId);
}

export function getSelectedWorkflow(): WorkflowPreset | undefined {
  return getWorkflowById(state.selectedWorkflowId);
}

export function upsertWorkflow(workflow: WorkflowPreset): void {
  const index = workflows.findIndex((item) => item.id === workflow.id);
  if (index >= 0) {
    workflows[index] = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      injections: cloneInjections(workflow.injections)
    };
    return;
  }

  workflows.push({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    injections: cloneInjections(workflow.injections)
  });
}

export function duplicateWorkflow(workflowId: string): WorkflowPreset | undefined {
  const source = getWorkflowById(workflowId);
  if (!source) {
    return undefined;
  }

  const suffix = Math.random().toString(36).slice(2, 6);
  const copy: WorkflowPreset = {
    id: `${source.id}-${suffix}`,
    name: `${source.name} Copy`,
    description: source.description,
    injections: cloneInjections(source.injections)
  };

  workflows.push(copy);
  return copy;
}

export function resetWorkflowsToDefault(): void {
  workflows.splice(0, workflows.length, ...cloneWorkflows(DEFAULT_WORKFLOWS));
  if (!workflows.some((item) => item.id === state.selectedWorkflowId)) {
    state.selectedWorkflowId = DEFAULT_WORKFLOW_ID;
  }

  for (const location of locations) {
    if (!workflows.some((item) => item.id === location.workflowId)) {
      location.workflowId = state.selectedWorkflowId;
    }
  }
}

export function addAgentInjection(workflow: WorkflowPreset, stage: HookStage): AgentInjection {
  const injection: AgentInjection = {
    id: `${stage}-${Math.random().toString(36).slice(2, 8)}`,
    agent: "custom_agent",
    instruction: "",
    enabled: true
  };
  workflow.injections[stage].push(injection);
  return injection;
}

export function removeAgentInjection(workflow: WorkflowPreset, stage: HookStage, injectionId: string): void {
  workflow.injections[stage] = workflow.injections[stage].filter((item) => item.id !== injectionId);
}

export function ensureLocationWorkflowLock(location: LocationState): string {
  if (!getWorkflowById(location.workflowId)) {
    location.workflowId = state.selectedWorkflowId;
  }
  return location.workflowId;
}
