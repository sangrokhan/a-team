import { FIXED_STAGES, MAX_EVENTS, MAX_LOGS } from "./config.js";
import type {
  AgentInjection,
  AppState,
  DomRefs,
  EventInput,
  LocationRenderActions,
  LocationState,
  LogInput,
  TransportState,
  WorkflowPreset
} from "./types.js";
import { createId, formatTime, shortId } from "./utils.js";

export interface WorkflowEditorActions {
  onAddAgent: (stage: (typeof FIXED_STAGES)[number]["key"]) => void;
  onRemoveAgent: (stage: (typeof FIXED_STAGES)[number]["key"], injectionId: string) => void;
  onUpdateAgent: (
    stage: (typeof FIXED_STAGES)[number]["key"],
    injectionId: string,
    patch: Partial<Pick<AgentInjection, "agent" | "instruction" | "enabled">>
  ) => void;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required element: ${id}`);
  }
  return node as T;
}

export function getDomRefs(): DomRefs {
  return {
    outputEl: mustGet<HTMLDivElement>("output"),
    eventListEl: mustGet<HTMLUListElement>("eventList"),
    locationListEl: mustGet<HTMLDivElement>("locationList"),
    locationSelectEl: mustGet<HTMLSelectElement>("targetLocation"),
    workflowSelectEl: mustGet<HTMLSelectElement>("workflowSelect"),
    workflowNameInputEl: mustGet<HTMLInputElement>("workflowNameInput"),
    workflowDescInputEl: mustGet<HTMLInputElement>("workflowDescInput"),
    stageEditorGridEl: mustGet<HTMLDivElement>("stageEditorGrid"),
    saveWorkflowBtnEl: mustGet<HTMLButtonElement>("saveWorkflowBtn"),
    duplicateWorkflowBtnEl: mustGet<HTMLButtonElement>("duplicateWorkflowBtn"),
    resetWorkflowBtnEl: mustGet<HTMLButtonElement>("resetWorkflowBtn"),
    commandFormEl: mustGet<HTMLFormElement>("commandForm"),
    commandInputEl: mustGet<HTMLInputElement>("commandInput"),
    clearLogsBtnEl: mustGet<HTMLButtonElement>("clearLogsBtn"),
    globalStatusEl: mustGet<HTMLSpanElement>("globalStatus"),
    routeTargetEl: mustGet<HTMLDivElement>("routeTarget"),
    transportStatusEl: mustGet<HTMLSpanElement>("transportStatus"),
    endpointInputEl: mustGet<HTMLInputElement>("endpointInput"),
    connectBtnEl: mustGet<HTMLButtonElement>("connectBtn"),
    disconnectBtnEl: mustGet<HTMLButtonElement>("disconnectBtn"),
    locationCardTemplate: mustGet<HTMLTemplateElement>("locationCardTemplate"),
    stageCardTemplate: mustGet<HTMLTemplateElement>("stageCardTemplate"),
    agentRowTemplate: mustGet<HTMLTemplateElement>("agentRowTemplate"),
    logLineTemplate: mustGet<HTMLTemplateElement>("logLineTemplate"),
    eventItemTemplate: mustGet<HTMLTemplateElement>("eventItemTemplate")
  };
}

export function setGlobalStatus(state: AppState, refs: DomRefs): void {
  const hasRun = state.globalActiveRuns > 0;
  refs.globalStatusEl.textContent = hasRun ? "Live" : "Idle";
  refs.globalStatusEl.classList.toggle("live", hasRun);
  refs.globalStatusEl.classList.toggle("idle", !hasRun);
}

export function updateTransportUi(transport: TransportState, refs: DomRefs): void {
  refs.transportStatusEl.classList.remove("mode-sim", "mode-connecting", "mode-live", "mode-error");

  if (transport.connected && transport.initialized) {
    refs.transportStatusEl.textContent = "Connected";
    refs.transportStatusEl.classList.add("mode-live");
  } else if (transport.connected && !transport.initialized) {
    refs.transportStatusEl.textContent = "Initializing";
    refs.transportStatusEl.classList.add("mode-connecting");
  } else if (transport.mode === "connecting") {
    refs.transportStatusEl.textContent = "Connecting";
    refs.transportStatusEl.classList.add("mode-connecting");
  } else if (transport.mode === "error") {
    refs.transportStatusEl.textContent = "Error";
    refs.transportStatusEl.classList.add("mode-error");
  } else {
    refs.transportStatusEl.textContent = "Simulation";
    refs.transportStatusEl.classList.add("mode-sim");
  }

  refs.connectBtnEl.disabled = transport.mode === "connecting" || transport.connected;
  refs.disconnectBtnEl.disabled = !transport.connected && transport.mode !== "connecting";
}

export function renderLogs(state: AppState, refs: DomRefs): void {
  refs.outputEl.innerHTML = "";
  for (const log of state.logs) {
    const node = refs.logLineTemplate.content.firstElementChild?.cloneNode(true) as HTMLDivElement;
    node.classList.add(log.kind);
    node.querySelector(".stamp")!.textContent = log.timestamp;
    node.querySelector(".channel")!.textContent = log.channel;
    node.querySelector(".text")!.textContent = log.text;
    refs.outputEl.appendChild(node);
  }
  refs.outputEl.scrollTop = refs.outputEl.scrollHeight;
}

export function renderEvents(state: AppState, refs: DomRefs): void {
  refs.eventListEl.innerHTML = "";
  for (const event of state.events) {
    const item = refs.eventItemTemplate.content.firstElementChild?.cloneNode(true) as HTMLLIElement;
    item.querySelector(".tag")!.textContent = event.tag;
    item.querySelector("time")!.textContent = event.timestamp;
    item.querySelector("p")!.textContent = event.text;
    refs.eventListEl.appendChild(item);
  }
}

export function addLog(state: AppState, refs: DomRefs, input: LogInput): void {
  state.logs.push({
    id: createId(),
    channel: input.channel,
    text: input.text,
    kind: input.kind || "system",
    timestamp: formatTime()
  });

  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
  renderLogs(state, refs);
}

export function addEvent(state: AppState, refs: DomRefs, input: EventInput): void {
  state.events.unshift({
    id: createId(),
    tag: input.tag,
    text: input.text,
    timestamp: formatTime()
  });

  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(0, MAX_EVENTS);
  }
  renderEvents(state, refs);
}

export function renderLocationOptions(locations: LocationState[], state: AppState, refs: DomRefs): void {
  refs.locationSelectEl.innerHTML = "";
  for (const location of locations) {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    refs.locationSelectEl.appendChild(option);
  }
  refs.locationSelectEl.value = state.selectedLocationId;
}

export function renderWorkflowOptions(workflows: WorkflowPreset[], state: AppState, refs: DomRefs): void {
  refs.workflowSelectEl.innerHTML = "";
  for (const workflow of workflows) {
    const option = document.createElement("option");
    option.value = workflow.id;
    option.textContent = workflow.name;
    refs.workflowSelectEl.appendChild(option);
  }
  refs.workflowSelectEl.value = state.selectedWorkflowId;
}

export function updateRouteTarget(locations: LocationState[], state: AppState, refs: DomRefs): void {
  const location = locations.find((item) => item.id === state.selectedLocationId);
  refs.routeTargetEl.textContent = location ? location.name : "Select location";
}

export function renderLocations(
  locations: LocationState[],
  state: AppState,
  refs: DomRefs,
  actions: LocationRenderActions
): void {
  refs.locationListEl.innerHTML = "";

  for (const location of locations) {
    const card = refs.locationCardTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;
    const dot = card.querySelector(".dot") as HTMLElement;
    const title = card.querySelector("h3") as HTMLElement;
    const meta = card.querySelector(".meta") as HTMLElement;

    const newThreadBtn = card.querySelector(".new-thread-btn") as HTMLButtonElement;
    const pauseBtn = card.querySelector(".pause-btn") as HTMLButtonElement;
    const interruptBtn = card.querySelector(".interrupt-btn") as HTMLButtonElement;

    title.textContent = location.name;
    meta.textContent = [
      `state=${location.paused ? "paused" : (location.running ? "running" : "ready")}`,
      `queue=${location.queue}`,
      `thread=${shortId(location.threadId)}`,
      `turn=${shortId(location.activeTurnId)}`,
      `wf=${location.workflowId}`
    ].join(" ");

    if (location.running) {
      dot.classList.add("running");
    }

    if (location.paused) {
      card.classList.add("paused");
      dot.classList.add("paused");
      pauseBtn.textContent = "Resume";
    }

    if (location.id === state.selectedLocationId) {
      card.classList.add("active");
    }

    card.addEventListener("click", () => actions.onSelect(location.id));

    newThreadBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.onNewThread(location.id);
    });

    pauseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.onTogglePause(location.id);
    });

    interruptBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.onInterrupt(location.id);
    });

    refs.locationListEl.appendChild(card);
  }
}

export function renderWorkflowStudio(
  workflow: WorkflowPreset | undefined,
  refs: DomRefs,
  actions: WorkflowEditorActions
): void {
  refs.stageEditorGridEl.innerHTML = "";

  if (!workflow) {
    refs.workflowNameInputEl.value = "";
    refs.workflowDescInputEl.value = "";
    return;
  }

  refs.workflowNameInputEl.value = workflow.name;
  refs.workflowDescInputEl.value = workflow.description;

  for (const stageDef of FIXED_STAGES) {
    const stage = stageDef.key;
    const section = refs.stageCardTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;

    (section.querySelector(".stage-title") as HTMLElement).textContent = stageDef.title;
    (section.querySelector(".stage-desc") as HTMLElement).textContent = stageDef.description;

    const addBtn = section.querySelector(".add-agent-btn") as HTMLButtonElement;
    const listEl = section.querySelector(".agent-list") as HTMLDivElement;

    addBtn.addEventListener("click", () => actions.onAddAgent(stage));

    for (const injection of workflow.injections[stage]) {
      const row = refs.agentRowTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;
      const nameInput = row.querySelector(".agent-name-input") as HTMLInputElement;
      const enabledInput = row.querySelector(".agent-enabled-input") as HTMLInputElement;
      const instructionInput = row.querySelector(".agent-instruction-input") as HTMLTextAreaElement;
      const removeBtn = row.querySelector(".remove-agent-btn") as HTMLButtonElement;

      nameInput.value = injection.agent;
      enabledInput.checked = injection.enabled;
      instructionInput.value = injection.instruction;

      nameInput.addEventListener("change", () => {
        actions.onUpdateAgent(stage, injection.id, { agent: nameInput.value });
      });

      enabledInput.addEventListener("change", () => {
        actions.onUpdateAgent(stage, injection.id, { enabled: enabledInput.checked });
      });

      instructionInput.addEventListener("change", () => {
        actions.onUpdateAgent(stage, injection.id, { instruction: instructionInput.value });
      });

      removeBtn.addEventListener("click", () => {
        actions.onRemoveAgent(stage, injection.id);
      });

      listEl.appendChild(row);
    }

    refs.stageEditorGridEl.appendChild(section);
  }
}
