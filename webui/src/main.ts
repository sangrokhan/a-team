import { DEFAULT_ENDPOINT, FIXED_STAGES } from "./config.js";
import {
  addAgentInjection,
  clearRunCount,
  clearSimulationTimers,
  decreaseRunCount,
  duplicateWorkflow,
  ensureLocationWorkflowLock,
  findLocation,
  getSelectedWorkflow,
  getWorkflowById,
  increaseRunCount,
  locationFromParams,
  locations,
  removeAgentInjection,
  resetWorkflowsToDefault,
  setSelectedLocationId,
  setSelectedWorkflowId,
  state,
  upsertWorkflow,
  workflows
} from "./state.js";
import { createTransport } from "./transport.js";
import type { AgentInjection, HookRuntimeContext, HookStage, WorkflowPreset } from "./types.js";
import {
  addEvent,
  addLog,
  getDomRefs,
  renderEvents,
  renderLocationOptions,
  renderLocations,
  renderLogs,
  renderWorkflowOptions,
  renderWorkflowStudio,
  setGlobalStatus,
  updateRouteTarget,
  updateTransportUi
} from "./ui.js";
import { safeJson, shortId } from "./utils.js";

const STORAGE_KEY = "codex-control-surface.workflows.v1";

const refs = getDomRefs();

const transport = createTransport(state, {
  onStateChange: () => {
    setGlobalStatus(state, refs);
    updateTransportUi(state.transport, refs);
    renderLocationCards();
  },
  onNotification: (method, params) => {
    handleServerNotification(method, params);
  },
  onLog: (input) => {
    addLog(state, refs, input);
  },
  onEvent: (input) => {
    addEvent(state, refs, input);
  }
});

function persistWorkflows(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  } catch {
    addLog(state, refs, { channel: "workflow", text: "Failed to persist workflows", kind: "error" });
  }
}

function readStoredWorkflows(): WorkflowPreset[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized: WorkflowPreset[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Record<string, unknown>;
      if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
        continue;
      }

      const description = typeof candidate.description === "string" ? candidate.description : "";
      const injectionsRaw = candidate.injections as Record<string, unknown> | undefined;

      const next: WorkflowPreset = {
        id: candidate.id,
        name: candidate.name,
        description,
        injections: {
          beforeDispatch: [],
          afterThreadReady: [],
          beforeTurnStart: [],
          afterTurnCompleted: [],
          onError: []
        }
      };

      for (const stageDef of FIXED_STAGES) {
        const stage = stageDef.key;
        const list = injectionsRaw?.[stage];
        if (!Array.isArray(list)) {
          continue;
        }

        next.injections[stage] = list
          .filter((entry) => entry && typeof entry === "object")
          .map((entry, index): AgentInjection => {
            const src = entry as Record<string, unknown>;
            return {
              id:
                typeof src.id === "string"
                  ? src.id
                  : `${stage}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              agent: typeof src.agent === "string" ? src.agent : "custom_agent",
              instruction: typeof src.instruction === "string" ? src.instruction : "",
              enabled: typeof src.enabled === "boolean" ? src.enabled : true
            };
          });
      }

      normalized.push(next);
    }

    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function hydrateWorkflowsFromStorage(): void {
  const stored = readStoredWorkflows();
  if (!stored) {
    return;
  }

  workflows.splice(0, workflows.length, ...stored);

  if (!workflows.some((item) => item.id === state.selectedWorkflowId)) {
    state.selectedWorkflowId = workflows[0].id;
  }

  for (const location of locations) {
    if (!workflows.some((item) => item.id === location.workflowId)) {
      location.workflowId = state.selectedWorkflowId;
    }
  }
}

function renderLocationCards(): void {
  renderLocations(locations, state, refs, {
    onSelect: (locationId) => {
      setSelectedLocation(locationId);
    },
    onNewThread: (locationId) => {
      void createThreadForLocation(locationId);
    },
    onTogglePause: (locationId) => {
      togglePause(locationId);
    },
    onInterrupt: (locationId) => {
      void interruptLocation(locationId, "Interrupted from location card");
    }
  });
}

function rerenderWorkflowStudio(): void {
  const selected = getSelectedWorkflow();
  renderWorkflowOptions(workflows, state, refs);
  renderWorkflowStudio(selected, refs, {
    onAddAgent: (stage) => {
      const workflow = getSelectedWorkflow();
      if (!workflow) {
        return;
      }
      addAgentInjection(workflow, stage);
      rerenderWorkflowStudio();
    },
    onRemoveAgent: (stage, injectionId) => {
      const workflow = getSelectedWorkflow();
      if (!workflow) {
        return;
      }
      removeAgentInjection(workflow, stage, injectionId);
      rerenderWorkflowStudio();
    },
    onUpdateAgent: (stage, injectionId, patch) => {
      const workflow = getSelectedWorkflow();
      if (!workflow) {
        return;
      }
      const target = workflow.injections[stage].find((item) => item.id === injectionId);
      if (!target) {
        return;
      }
      Object.assign(target, patch);
    }
  });
}

function setSelectedLocation(locationId: string): void {
  setSelectedLocationId(locationId);
  refs.locationSelectEl.value = locationId;
  updateRouteTarget(locations, state, refs);
  renderLocationCards();
}

function togglePause(locationId: string): void {
  const location = findLocation(locationId);
  if (!location) {
    return;
  }

  location.paused = !location.paused;
  addEvent(state, refs, {
    tag: location.paused ? "pause" : "resume",
    text: `${location.name} ${location.paused ? "paused" : "resumed"}`
  });
  addLog(state, refs, {
    channel: location.name,
    text: location.paused ? "Paused by operator" : "Resumed by operator",
    kind: "system"
  });
  renderLocationCards();
}

function summarizeNotification(method: string, params: Record<string, unknown>): string {
  if (typeof params.delta === "string") {
    return params.delta;
  }

  const turn = params.turn as { id?: string; status?: { type?: string } } | undefined;
  if (turn?.status?.type) {
    return `turn=${turn.id || "-"} status=${turn.status.type}`;
  }

  const status = params.status as { type?: string } | undefined;
  if (status?.type) {
    return `status=${status.type}`;
  }

  if (params.error) {
    return safeJson(params.error);
  }

  const thread = params.thread as { id?: string } | undefined;
  if (thread?.id) {
    return `thread=${thread.id}`;
  }

  return safeJson(params);
}

function inferChannel(params: Record<string, unknown>): string {
  const location = locationFromParams(params);
  return location ? location.name : "server";
}

function runStageInjections(
  location: (typeof locations)[number],
  stage: HookStage,
  context: HookRuntimeContext
): HookRuntimeContext {
  const workflow = getWorkflowById(location.workflowId) || getSelectedWorkflow();
  if (!workflow) {
    return context;
  }

  const injections = workflow.injections[stage].filter((item) => item.enabled);
  if (injections.length === 0) {
    return context;
  }

  const next: HookRuntimeContext = {
    command: context.command,
    threadId: context.threadId,
    turnId: context.turnId,
    error: context.error
  };

  for (const injection of injections) {
    addEvent(state, refs, {
      tag: `inject/${stage}`,
      text: `${location.name} <${injection.agent}> ${injection.instruction || "(no instruction)"}`
    });

    if ((stage === "beforeDispatch" || stage === "beforeTurnStart") && injection.instruction.trim().length > 0) {
      next.command = `${next.command}\n[agent:${injection.agent}] ${injection.instruction}`;
    }

    if (stage === "afterTurnCompleted") {
      addLog(state, refs, {
        channel: location.name,
        text: `[${injection.agent}] completion check: ${injection.instruction}`,
        kind: "system"
      });
    }

    if (stage === "onError") {
      addLog(state, refs, {
        channel: location.name,
        text: `[${injection.agent}] error strategy: ${injection.instruction}`,
        kind: "error"
      });
    }
  }

  return next;
}

function lockWorkflowForLocation(location: (typeof locations)[number], forceCurrentSelection: boolean): void {
  if (forceCurrentSelection || !location.threadId) {
    location.workflowId = state.selectedWorkflowId;
    return;
  }
  ensureLocationWorkflowLock(location);
}

async function ensureThreadForLocation(location: (typeof locations)[number], forceNew = false): Promise<string> {
  if (!forceNew && location.threadId) {
    return location.threadId;
  }

  if (!transport.isLive()) {
    throw new Error("Transport is not connected");
  }

  if (location.running) {
    throw new Error("Cannot rotate thread while run is active");
  }

  lockWorkflowForLocation(location, true);

  location.threadId = null;
  location.activeTurnId = null;

  const response = (await transport.sendRpc("thread/start", {
    cwd: location.cwd,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    serviceName: location.name
  })) as { thread?: { id?: string } };

  const threadId = response?.thread?.id;
  if (!threadId) {
    throw new Error("thread/start response missing thread id");
  }

  location.threadId = threadId;
  runStageInjections(location, "afterThreadReady", { command: "", threadId });

  renderLocationCards();

  addLog(state, refs, {
    channel: location.name,
    text: `thread ready ${shortId(threadId)} (wf=${location.workflowId})`,
    kind: "system"
  });

  addEvent(state, refs, {
    tag: "thread",
    text: `${location.name} -> ${shortId(threadId)} / wf=${location.workflowId}`
  });

  return threadId;
}

function enqueueSimulation(location: (typeof locations)[number], command: string): void {
  increaseRunCount(location);
  setGlobalStatus(state, refs);
  renderLocationCards();

  addEvent(state, refs, { tag: "dispatch(sim)", text: `${location.name} <- ${command}` });

  const steps: Array<{ delay: number; message: string; final?: boolean }> = [
    { delay: 220, message: "request accepted" },
    { delay: 680, message: "planning turn + checking policy" },
    { delay: 1250, message: "streaming output chunk #1" },
    { delay: 1700, message: "streaming output chunk #2" },
    { delay: 2140, message: "turn completed", final: true }
  ];

  for (const step of steps) {
    const timerId = window.setTimeout(() => {
      const latest = findLocation(location.id);
      if (!latest || latest.paused) {
        return;
      }

      addLog(state, refs, {
        channel: latest.name,
        text: `${command} -> ${step.message}`,
        kind: "system"
      });

      addEvent(state, refs, {
        tag: step.final ? "done(sim)" : "update(sim)",
        text: `${latest.name}: ${step.message}`
      });

      if (step.final) {
        runStageInjections(latest, "afterTurnCompleted", {
          command,
          threadId: latest.threadId || undefined,
          turnId: latest.activeTurnId || undefined
        });

        decreaseRunCount(latest);
        setGlobalStatus(state, refs);
        renderLocationCards();
      }
    }, step.delay + Math.floor(Math.random() * 150));

    location.simTimers.push(timerId);
  }
}

async function handleLiveCommand(location: (typeof locations)[number], command: string): Promise<void> {
  increaseRunCount(location);
  setGlobalStatus(state, refs);
  renderLocationCards();

  addEvent(state, refs, { tag: "dispatch", text: `${location.name} <- ${command}` });

  try {
    const threadId = await ensureThreadForLocation(location, false);
    const prepared = runStageInjections(location, "beforeTurnStart", {
      command,
      threadId
    });

    const response = (await transport.sendRpc("turn/start", {
      threadId,
      input: [{ type: "text", text: prepared.command }]
    })) as { turn?: { id?: string; status?: { type?: string } | string } };

    const turnId = response?.turn?.id || null;
    if (turnId) {
      location.activeTurnId = turnId;
    }

    const turnStatus = response?.turn?.status;
    const turnStatusType = typeof turnStatus === "string" ? turnStatus : turnStatus?.type;

    if (turnStatusType === "completed") {
      runStageInjections(location, "afterTurnCompleted", {
        command: prepared.command,
        threadId,
        turnId: turnId || undefined
      });
      decreaseRunCount(location);
      setGlobalStatus(state, refs);
    }

    if (turnStatusType === "failed") {
      runStageInjections(location, "onError", {
        command: prepared.command,
        threadId,
        turnId: turnId || undefined,
        error: "turn failed"
      });
      decreaseRunCount(location);
      setGlobalStatus(state, refs);
    }

    renderLocationCards();

    addLog(state, refs, {
      channel: location.name,
      text: `turn started ${shortId(turnId || "")} / wf=${location.workflowId}`,
      kind: "system"
    });
  } catch (error) {
    runStageInjections(location, "onError", {
      command,
      threadId: location.threadId || undefined,
      turnId: location.activeTurnId || undefined,
      error: (error as Error).message
    });

    decreaseRunCount(location);
    setGlobalStatus(state, refs);
    renderLocationCards();

    addLog(state, refs, {
      channel: location.name,
      text: `command failed ${(error as Error).message}`,
      kind: "error"
    });

    addEvent(state, refs, {
      tag: "failure",
      text: `${location.name}: ${(error as Error).message}`
    });
  }
}

function interruptSimulation(location: (typeof locations)[number], reason = "Interrupted by user"): void {
  clearSimulationTimers(location);
  clearRunCount(location);
  setGlobalStatus(state, refs);
  renderLocationCards();

  addLog(state, refs, {
    channel: location.name,
    text: reason,
    kind: "error"
  });

  addEvent(state, refs, {
    tag: "interrupt(sim)",
    text: `${location.name}: ${reason}`
  });
}

async function interruptLive(location: (typeof locations)[number], reason = "Interrupted by user"): Promise<void> {
  if (!location.threadId || !location.activeTurnId) {
    addLog(state, refs, {
      channel: location.name,
      text: "No active turn to interrupt",
      kind: "error"
    });
    return;
  }

  try {
    await transport.sendRpc("turn/interrupt", {
      threadId: location.threadId,
      turnId: location.activeTurnId
    });

    decreaseRunCount(location);
    setGlobalStatus(state, refs);
    renderLocationCards();

    addLog(state, refs, {
      channel: location.name,
      text: reason,
      kind: "error"
    });

    addEvent(state, refs, {
      tag: "interrupt",
      text: `${location.name}: ${reason}`
    });
  } catch (error) {
    addLog(state, refs, {
      channel: location.name,
      text: `interrupt failed ${(error as Error).message}`,
      kind: "error"
    });
  }
}

async function interruptLocation(locationId: string, reason = "Interrupted by user"): Promise<void> {
  const location = findLocation(locationId);
  if (!location) {
    return;
  }

  if (transport.isLive()) {
    await interruptLive(location, reason);
    return;
  }

  interruptSimulation(location, reason);
}

async function createThreadForLocation(locationId: string): Promise<void> {
  const location = findLocation(locationId);
  if (!location) {
    return;
  }

  lockWorkflowForLocation(location, true);

  if (!transport.isLive()) {
    location.threadId = null;
    location.activeTurnId = null;
    renderLocationCards();
    addLog(state, refs, {
      channel: location.name,
      text: `thread reset (simulation mode), wf=${location.workflowId}`,
      kind: "system"
    });
    return;
  }

  try {
    await ensureThreadForLocation(location, true);
  } catch (error) {
    runStageInjections(location, "onError", {
      command: "",
      error: (error as Error).message
    });

    addLog(state, refs, {
      channel: location.name,
      text: `new thread failed ${(error as Error).message}`,
      kind: "error"
    });
  }
}

async function handleCommand(command: string, locationId: string): Promise<void> {
  const location = findLocation(locationId);
  if (!location) {
    addLog(state, refs, {
      channel: "system",
      text: "Invalid location",
      kind: "error"
    });
    return;
  }

  if (location.paused) {
    addLog(state, refs, {
      channel: location.name,
      text: "Location is paused. Resume first.",
      kind: "error"
    });
    addEvent(state, refs, {
      tag: "blocked",
      text: `${location.name} is paused`
    });
    return;
  }

  addLog(state, refs, {
    channel: "user",
    text: `[${location.name}] ${command}`,
    kind: "user"
  });

  if (command.startsWith("/turn/interrupt") || command === "interrupt") {
    await interruptLocation(location.id, "Interrupted via command input");
    return;
  }

  if (command.startsWith("/thread/start") && transport.isLive()) {
    await createThreadForLocation(location.id);
    return;
  }

  lockWorkflowForLocation(location, false);

  const prepared = runStageInjections(location, "beforeDispatch", {
    command
  });

  if (transport.isLive()) {
    await handleLiveCommand(location, prepared.command);
    return;
  }

  enqueueSimulation(location, prepared.command);
  renderLocationCards();
}

function handleServerNotification(method: string, params: Record<string, unknown>): void {
  const channel = inferChannel(params);
  const location = locationFromParams(params);
  const summary = summarizeNotification(method, params);

  addEvent(state, refs, {
    tag: method,
    text: `${channel}: ${summary}`
  });

  switch (method) {
    case "turn/started": {
      if (location) {
        const turn = params.turn as { id?: string } | undefined;
        const turnId = turn?.id || null;
        if (turnId) {
          location.activeTurnId = turnId;
        }
        location.running = location.queue > 0;
        renderLocationCards();
      }
      addLog(state, refs, {
        channel,
        text: `turn started ${shortId((params.turn as { id?: string } | undefined)?.id || "")}`,
        kind: "system"
      });
      break;
    }
    case "turn/completed": {
      if (location) {
        runStageInjections(location, "afterTurnCompleted", {
          command: "",
          threadId: location.threadId || undefined,
          turnId: location.activeTurnId || undefined
        });
        decreaseRunCount(location);
        setGlobalStatus(state, refs);
        renderLocationCards();
      }
      addLog(state, refs, {
        channel,
        text: `turn completed ${shortId((params.turn as { id?: string } | undefined)?.id || "")}`,
        kind: "system"
      });
      break;
    }
    case "thread/status/changed": {
      if (location) {
        const status = params.status as { type?: string } | undefined;
        const statusType = status?.type || "unknown";
        location.running = statusType === "active" || location.queue > 0;
        renderLocationCards();
      }
      addLog(state, refs, {
        channel,
        text: `thread status ${(params.status as { type?: string } | undefined)?.type || "unknown"}`,
        kind: "system"
      });
      break;
    }
    case "thread/started": {
      const threadId = (params.thread as { id?: string } | undefined)?.id || null;
      addLog(state, refs, {
        channel,
        text: `thread started ${shortId(threadId || "")}`,
        kind: "system"
      });
      break;
    }
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      if (typeof params.delta === "string" && params.delta.trim().length > 0) {
        addLog(state, refs, {
          channel,
          text: params.delta,
          kind: "system"
        });
      }
      break;
    }
    case "error": {
      addLog(state, refs, {
        channel,
        text: `error ${safeJson(params.error)}`,
        kind: "error"
      });
      if (location) {
        runStageInjections(location, "onError", {
          command: "",
          error: safeJson(params.error),
          threadId: location.threadId || undefined,
          turnId: location.activeTurnId || undefined
        });
      }
      if (location && location.running) {
        decreaseRunCount(location);
        setGlobalStatus(state, refs);
        renderLocationCards();
      }
      break;
    }
    default: {
      addLog(state, refs, {
        channel,
        text: `${method} ${summary}`,
        kind: "system"
      });
      break;
    }
  }
}

function registerEvents(): void {
  refs.commandFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const command = refs.commandInputEl.value.trim();
    if (!command) {
      return;
    }

    void handleCommand(command, refs.locationSelectEl.value);
    refs.commandInputEl.value = "";
    refs.commandInputEl.focus();
  });

  refs.locationSelectEl.addEventListener("change", () => {
    setSelectedLocation(refs.locationSelectEl.value);
  });

  refs.workflowSelectEl.addEventListener("change", () => {
    setSelectedWorkflowId(refs.workflowSelectEl.value);
    rerenderWorkflowStudio();
    renderLocationCards();
    addEvent(state, refs, {
      tag: "workflow",
      text: `selected workflow: ${state.selectedWorkflowId}`
    });
  });

  refs.workflowNameInputEl.addEventListener("change", () => {
    const workflow = getSelectedWorkflow();
    if (!workflow) {
      return;
    }
    workflow.name = refs.workflowNameInputEl.value || "Untitled Workflow";
    rerenderWorkflowStudio();
  });

  refs.workflowDescInputEl.addEventListener("change", () => {
    const workflow = getSelectedWorkflow();
    if (!workflow) {
      return;
    }
    workflow.description = refs.workflowDescInputEl.value;
  });

  refs.saveWorkflowBtnEl.addEventListener("click", () => {
    const workflow = getSelectedWorkflow();
    if (!workflow) {
      return;
    }

    upsertWorkflow(workflow);
    persistWorkflows();
    rerenderWorkflowStudio();

    addLog(state, refs, {
      channel: "workflow",
      text: `saved ${workflow.id}`,
      kind: "system"
    });
  });

  refs.duplicateWorkflowBtnEl.addEventListener("click", () => {
    const duplicated = duplicateWorkflow(state.selectedWorkflowId);
    if (!duplicated) {
      return;
    }

    setSelectedWorkflowId(duplicated.id);
    persistWorkflows();
    rerenderWorkflowStudio();

    addLog(state, refs, {
      channel: "workflow",
      text: `duplicated ${duplicated.id}`,
      kind: "system"
    });
  });

  refs.resetWorkflowBtnEl.addEventListener("click", () => {
    resetWorkflowsToDefault();
    persistWorkflows();
    rerenderWorkflowStudio();
    renderLocationCards();

    addLog(state, refs, {
      channel: "workflow",
      text: "workflow defaults restored",
      kind: "system"
    });
  });

  refs.endpointInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      transport.connect(refs.endpointInputEl.value.trim());
    }
  });

  refs.connectBtnEl.addEventListener("click", () => {
    transport.connect(refs.endpointInputEl.value.trim());
  });

  refs.disconnectBtnEl.addEventListener("click", () => {
    transport.disconnect("Disconnected by operator");
  });

  refs.clearLogsBtnEl.addEventListener("click", () => {
    state.logs = [];
    state.events = [];
    renderLogs(state, refs);
    renderEvents(state, refs);

    addLog(state, refs, {
      channel: "system",
      text: "Output cleared",
      kind: "system"
    });
  });

  document.querySelectorAll<HTMLElement>("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      const quick = button.dataset.quick || "";
      refs.commandInputEl.value = quick;
      refs.commandInputEl.focus();
    });
  });
}

function bootstrap(): void {
  hydrateWorkflowsFromStorage();

  refs.endpointInputEl.value = DEFAULT_ENDPOINT;

  renderLocationOptions(locations, state, refs);
  renderWorkflowOptions(workflows, state, refs);
  renderLocationCards();
  renderLogs(state, refs);
  renderEvents(state, refs);
  rerenderWorkflowStudio();

  updateRouteTarget(locations, state, refs);
  setGlobalStatus(state, refs);
  updateTransportUi(state.transport, refs);

  registerEvents();

  addLog(state, refs, {
    channel: "system",
    text: "Control surface initialized",
    kind: "system"
  });
  addLog(state, refs, {
    channel: "system",
    text: "Select workflow, configure fixed-stage agents, then dispatch",
    kind: "system"
  });
  addEvent(state, refs, { tag: "ready", text: "UI boot complete" });
}

bootstrap();
