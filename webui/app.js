const DEFAULT_ENDPOINT = "ws://127.0.0.1:8765";
const RPC_TIMEOUT_MS = 30000;
const MAX_LOGS = 700;
const MAX_EVENTS = 30;

const locations = [
  {
    id: "seoul-gateway",
    name: "Seoul Gateway",
    cwd: "/Users/han/Repo/a-team",
    paused: false,
    running: false,
    queue: 0,
    threadId: null,
    activeTurnId: null,
    simTimers: []
  },
  {
    id: "tokyo-sandbox",
    name: "Tokyo Sandbox",
    cwd: "/tmp",
    paused: false,
    running: false,
    queue: 0,
    threadId: null,
    activeTurnId: null,
    simTimers: []
  },
  {
    id: "sf-orchestrator",
    name: "SF Orchestrator",
    cwd: "/tmp",
    paused: false,
    running: false,
    queue: 0,
    threadId: null,
    activeTurnId: null,
    simTimers: []
  },
  {
    id: "eu-observer",
    name: "EU Observer",
    cwd: "/tmp",
    paused: false,
    running: false,
    queue: 0,
    threadId: null,
    activeTurnId: null,
    simTimers: []
  }
];

const state = {
  selectedLocationId: locations[0].id,
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

const outputEl = document.getElementById("output");
const eventListEl = document.getElementById("eventList");
const locationListEl = document.getElementById("locationList");
const locationSelectEl = document.getElementById("targetLocation");
const commandFormEl = document.getElementById("commandForm");
const commandInputEl = document.getElementById("commandInput");
const clearLogsBtnEl = document.getElementById("clearLogsBtn");
const globalStatusEl = document.getElementById("globalStatus");
const routeTargetEl = document.getElementById("routeTarget");
const transportStatusEl = document.getElementById("transportStatus");
const endpointInputEl = document.getElementById("endpointInput");
const connectBtnEl = document.getElementById("connectBtn");
const disconnectBtnEl = document.getElementById("disconnectBtn");

const locationCardTemplate = document.getElementById("locationCardTemplate");
const logLineTemplate = document.getElementById("logLineTemplate");
const eventItemTemplate = document.getElementById("eventItemTemplate");

function createId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour12: false });
}

function shortId(value) {
  if (!value || typeof value !== "string") {
    return "-";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}..${value.slice(-4)}`;
}

function safeJson(value, limit = 170) {
  try {
    const text = JSON.stringify(value);
    if (!text) {
      return "";
    }
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  } catch {
    return String(value);
  }
}

function findLocation(locationId) {
  return locations.find((location) => location.id === locationId);
}

function findLocationByThreadId(threadId) {
  if (!threadId) {
    return null;
  }
  return locations.find((location) => location.threadId === threadId) || null;
}

function locationFromParams(params) {
  const threadId = params?.threadId || params?.thread?.id || null;
  if (threadId) {
    return findLocationByThreadId(threadId);
  }
  return findLocation(state.selectedLocationId);
}

function setGlobalStatus() {
  const hasRun = state.globalActiveRuns > 0;
  globalStatusEl.textContent = hasRun ? "Live" : "Idle";
  globalStatusEl.classList.toggle("live", hasRun);
  globalStatusEl.classList.toggle("idle", !hasRun);
}

function updateTransportUi() {
  const transport = state.transport;
  transportStatusEl.classList.remove("mode-sim", "mode-connecting", "mode-live", "mode-error");

  if (transport.connected && transport.initialized) {
    transportStatusEl.textContent = "Connected";
    transportStatusEl.classList.add("mode-live");
  } else if (transport.connected && !transport.initialized) {
    transportStatusEl.textContent = "Initializing";
    transportStatusEl.classList.add("mode-connecting");
  } else if (transport.mode === "connecting") {
    transportStatusEl.textContent = "Connecting";
    transportStatusEl.classList.add("mode-connecting");
  } else if (transport.mode === "error") {
    transportStatusEl.textContent = "Error";
    transportStatusEl.classList.add("mode-error");
  } else {
    transportStatusEl.textContent = "Simulation";
    transportStatusEl.classList.add("mode-sim");
  }

  connectBtnEl.disabled = transport.mode === "connecting" || transport.connected;
  disconnectBtnEl.disabled = !transport.connected && transport.mode !== "connecting";
}

function addLog({ channel, text, kind = "system" }) {
  const entry = {
    id: createId(),
    channel,
    text,
    kind,
    timestamp: formatTime()
  };

  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }

  renderLogs();
}

function addEvent({ tag, text }) {
  const event = {
    id: createId(),
    tag,
    text,
    timestamp: formatTime()
  };

  state.events.unshift(event);
  state.events = state.events.slice(0, MAX_EVENTS);
  renderEvents();
}

function renderLogs() {
  outputEl.innerHTML = "";
  for (const log of state.logs) {
    const node = logLineTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(log.kind);
    node.querySelector(".stamp").textContent = log.timestamp;
    node.querySelector(".channel").textContent = log.channel;
    node.querySelector(".text").textContent = log.text;
    outputEl.appendChild(node);
  }
  outputEl.scrollTop = outputEl.scrollHeight;
}

function renderEvents() {
  eventListEl.innerHTML = "";
  for (const event of state.events) {
    const item = eventItemTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector(".tag").textContent = event.tag;
    item.querySelector("time").textContent = event.timestamp;
    item.querySelector("p").textContent = event.text;
    eventListEl.appendChild(item);
  }
}

function updateRouteTarget() {
  const location = findLocation(state.selectedLocationId);
  routeTargetEl.textContent = location ? location.name : "Select location";
}

function renderLocationOptions() {
  locationSelectEl.innerHTML = "";
  for (const location of locations) {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    locationSelectEl.appendChild(option);
  }
  locationSelectEl.value = state.selectedLocationId;
}

function clearSimulationTimers(location) {
  for (const timerId of location.simTimers) {
    window.clearTimeout(timerId);
  }
  location.simTimers = [];
}

function increaseRunCount(location) {
  location.queue += 1;
  location.running = true;
  state.globalActiveRuns += 1;
  setGlobalStatus();
}

function decreaseRunCount(location) {
  if (location.queue > 0) {
    location.queue -= 1;
    state.globalActiveRuns = Math.max(0, state.globalActiveRuns - 1);
  }
  location.running = location.queue > 0;
  if (!location.running) {
    location.activeTurnId = null;
  }
  setGlobalStatus();
}

function clearRunCount(location) {
  if (location.queue > 0) {
    state.globalActiveRuns = Math.max(0, state.globalActiveRuns - location.queue);
  }
  location.queue = 0;
  location.running = false;
  location.activeTurnId = null;
  setGlobalStatus();
}

function setSelectedLocation(locationId) {
  state.selectedLocationId = locationId;
  locationSelectEl.value = locationId;
  updateRouteTarget();
  renderLocations();
}

function summarizeNotification(method, params) {
  if (typeof params?.delta === "string") {
    return params.delta;
  }
  if (params?.turn?.status?.type) {
    return `turn=${params.turn.id || "-"} status=${params.turn.status.type}`;
  }
  if (params?.status?.type) {
    return `status=${params.status.type}`;
  }
  if (params?.error) {
    return safeJson(params.error);
  }
  if (params?.thread?.id) {
    return `thread=${params.thread.id}`;
  }
  return safeJson(params);
}

function inferChannel(params) {
  const location = locationFromParams(params);
  return location ? location.name : "server";
}

function cleanupSocketState(mode = "simulation") {
  const transport = state.transport;
  transport.connected = false;
  transport.initialized = false;
  transport.socket = null;
  transport.mode = mode;

  for (const [id, pending] of transport.pending) {
    window.clearTimeout(pending.timeoutId);
    pending.reject(new Error("Socket closed"));
    transport.pending.delete(id);
  }

  updateTransportUi();
}

function handleRpcResponse(message) {
  const pending = state.transport.pending.get(message.id);
  if (!pending) {
    return;
  }

  state.transport.pending.delete(message.id);
  window.clearTimeout(pending.timeoutId);

  if (message.error) {
    pending.reject(new Error(message.error.message || "RPC error"));
    return;
  }

  pending.resolve(message.result);
}

function handleServerNotification(method, params) {
  const channel = inferChannel(params);
  const location = locationFromParams(params);
  const summary = summarizeNotification(method, params);

  addEvent({ tag: method, text: `${channel}: ${summary}` });

  switch (method) {
    case "turn/started": {
      if (location) {
        const turnId = params?.turn?.id || null;
        if (turnId) {
          location.activeTurnId = turnId;
        }
        location.running = location.queue > 0;
        renderLocations();
      }
      addLog({ channel, text: `turn started ${shortId(params?.turn?.id || "")}`, kind: "system" });
      break;
    }
    case "turn/completed": {
      if (location) {
        decreaseRunCount(location);
        renderLocations();
      }
      addLog({ channel, text: `turn completed ${shortId(params?.turn?.id || "")}`, kind: "system" });
      break;
    }
    case "thread/status/changed": {
      if (location) {
        const statusType = params?.status?.type || "unknown";
        location.running = statusType === "active" || location.queue > 0;
        renderLocations();
      }
      addLog({ channel, text: `thread status ${params?.status?.type || "unknown"}`, kind: "system" });
      break;
    }
    case "thread/started": {
      const threadId = params?.thread?.id || null;
      addLog({ channel, text: `thread started ${shortId(threadId || "")}`, kind: "system" });
      break;
    }
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      if (typeof params?.delta === "string" && params.delta.trim().length > 0) {
        addLog({ channel, text: params.delta, kind: "system" });
      }
      break;
    }
    case "error": {
      addLog({ channel, text: `error ${safeJson(params?.error)}`, kind: "error" });
      if (location && location.running) {
        decreaseRunCount(location);
        renderLocations();
      }
      break;
    }
    default: {
      addLog({ channel, text: `${method} ${summary}`, kind: "system" });
      break;
    }
  }
}

function handleSocketMessage(raw) {
  const payload = typeof raw === "string" ? raw : String(raw);
  const packets = payload.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const packet of packets) {
    let message;
    try {
      message = JSON.parse(packet);
    } catch {
      addLog({ channel: "socket", text: `invalid json ${packet.slice(0, 120)}`, kind: "error" });
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && (Object.prototype.hasOwnProperty.call(message, "result") || Object.prototype.hasOwnProperty.call(message, "error"))) {
      handleRpcResponse(message);
      continue;
    }

    if (typeof message.method === "string") {
      handleServerNotification(message.method, message.params || {});
      continue;
    }

    addLog({ channel: "socket", text: `unhandled packet ${safeJson(message)}`, kind: "error" });
  }
}

function sendRpc(method, params = {}) {
  const transport = state.transport;
  if (!transport.socket || transport.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Socket is not connected"));
  }

  const id = transport.nextId;
  transport.nextId += 1;

  const message = {
    id,
    method,
    params
  };

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      transport.pending.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    transport.pending.set(id, { resolve, reject, timeoutId, method });

    try {
      transport.socket.send(JSON.stringify(message));
    } catch (error) {
      window.clearTimeout(timeoutId);
      transport.pending.delete(id);
      reject(error);
    }
  });
}

async function initializeTransport() {
  const result = await sendRpc("initialize", {
    clientInfo: {
      name: "codex-control-surface",
      version: "0.2.0",
      title: "Codex Command Grid"
    },
    capabilities: {
      experimentalApi: true
    }
  });

  state.transport.initialized = true;
  updateTransportUi();

  addLog({ channel: "socket", text: `initialized ${result?.userAgent || ""}`.trim(), kind: "system" });
  addEvent({ tag: "initialize", text: "Handshake completed" });
}

function disconnectTransport(reason = "Disconnected") {
  const transport = state.transport;
  transport.manualClose = true;

  if (transport.socket && (transport.socket.readyState === WebSocket.OPEN || transport.socket.readyState === WebSocket.CONNECTING)) {
    transport.socket.close(1000, "client_disconnect");
  }

  cleanupSocketState("simulation");
  addLog({ channel: "socket", text: reason, kind: "system" });
  addEvent({ tag: "disconnect", text: reason });
}

function connectTransport() {
  const endpoint = endpointInputEl.value.trim();
  if (!endpoint) {
    addLog({ channel: "socket", text: "endpoint is empty", kind: "error" });
    return;
  }

  if (state.transport.connected || state.transport.mode === "connecting") {
    disconnectTransport("Reconnecting");
  }

  state.transport.endpoint = endpoint;
  state.transport.mode = "connecting";
  state.transport.connected = false;
  state.transport.initialized = false;
  state.transport.manualClose = false;
  updateTransportUi();

  addLog({ channel: "socket", text: `connecting ${endpoint}`, kind: "system" });
  addEvent({ tag: "connect", text: `dial ${endpoint}` });

  let socket;
  try {
    socket = new WebSocket(endpoint);
  } catch (error) {
    state.transport.mode = "error";
    updateTransportUi();
    addLog({ channel: "socket", text: `connect failed ${error.message}`, kind: "error" });
    return;
  }

  state.transport.socket = socket;

  socket.addEventListener("open", async () => {
    if (state.transport.socket !== socket) {
      return;
    }

    state.transport.connected = true;
    state.transport.mode = "live";
    updateTransportUi();

    addLog({ channel: "socket", text: "socket open", kind: "system" });

    try {
      await initializeTransport();
    } catch (error) {
      state.transport.mode = "error";
      updateTransportUi();
      addLog({ channel: "socket", text: `initialize failed ${error.message}`, kind: "error" });
    }
  });

  socket.addEventListener("message", (event) => {
    if (state.transport.socket !== socket) {
      return;
    }
    handleSocketMessage(event.data);
  });

  socket.addEventListener("error", () => {
    if (state.transport.socket !== socket) {
      return;
    }
    state.transport.mode = "error";
    updateTransportUi();
    addLog({ channel: "socket", text: "socket error", kind: "error" });
  });

  socket.addEventListener("close", () => {
    if (state.transport.socket !== socket) {
      return;
    }

    const closedByUser = state.transport.manualClose;
    cleanupSocketState(closedByUser ? "simulation" : "error");

    if (!closedByUser) {
      addLog({ channel: "socket", text: "socket closed", kind: "error" });
      addEvent({ tag: "disconnect", text: "connection lost" });
    }

    state.transport.manualClose = false;
  });
}

async function ensureThreadForLocation(location, forceNew = false) {
  if (!forceNew && location.threadId) {
    return location.threadId;
  }

  if (!state.transport.connected || !state.transport.initialized) {
    throw new Error("Transport is not connected");
  }

  if (location.running) {
    throw new Error("Cannot rotate thread while run is active");
  }

  location.threadId = null;
  location.activeTurnId = null;

  const response = await sendRpc("thread/start", {
    cwd: location.cwd,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    serviceName: location.name
  });

  const threadId = response?.thread?.id;
  if (!threadId) {
    throw new Error("thread/start response missing thread id");
  }

  location.threadId = threadId;
  renderLocations();

  addLog({ channel: location.name, text: `thread ready ${shortId(threadId)}`, kind: "system" });
  addEvent({ tag: "thread", text: `${location.name} -> ${shortId(threadId)}` });

  return threadId;
}

function enqueueSimulation(location, command) {
  increaseRunCount(location);
  renderLocations();

  addEvent({ tag: "dispatch(sim)", text: `${location.name} <- ${command}` });

  const steps = [
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

      addLog({ channel: latest.name, text: `${command} -> ${step.message}`, kind: "system" });
      addEvent({ tag: step.final ? "done(sim)" : "update(sim)", text: `${latest.name}: ${step.message}` });

      if (step.final) {
        decreaseRunCount(latest);
        renderLocations();
      }
    }, step.delay + Math.floor(Math.random() * 150));

    location.simTimers.push(timerId);
  }
}

async function handleLiveCommand(location, command) {
  increaseRunCount(location);
  renderLocations();

  addEvent({ tag: "dispatch", text: `${location.name} <- ${command}` });

  try {
    const threadId = await ensureThreadForLocation(location);

    const response = await sendRpc("turn/start", {
      threadId,
      input: [{ type: "text", text: command }]
    });

    const turnId = response?.turn?.id || null;
    if (turnId) {
      location.activeTurnId = turnId;
    }

    const turnStatusType = response?.turn?.status?.type || response?.turn?.status || null;
    if (turnStatusType === "completed" || turnStatusType === "failed") {
      decreaseRunCount(location);
    }

    renderLocations();
    addLog({ channel: location.name, text: `turn started ${shortId(turnId || "")}`, kind: "system" });
  } catch (error) {
    decreaseRunCount(location);
    renderLocations();

    addLog({ channel: location.name, text: `command failed ${error.message}`, kind: "error" });
    addEvent({ tag: "failure", text: `${location.name}: ${error.message}` });
  }
}

function interruptSimulation(location, reason = "Interrupted by user") {
  clearSimulationTimers(location);
  clearRunCount(location);
  renderLocations();

  addLog({ channel: location.name, text: reason, kind: "error" });
  addEvent({ tag: "interrupt(sim)", text: `${location.name}: ${reason}` });
}

async function interruptLive(location, reason = "Interrupted by user") {
  if (!location.threadId || !location.activeTurnId) {
    addLog({ channel: location.name, text: "No active turn to interrupt", kind: "error" });
    return;
  }

  try {
    await sendRpc("turn/interrupt", {
      threadId: location.threadId,
      turnId: location.activeTurnId
    });

    decreaseRunCount(location);
    renderLocations();

    addLog({ channel: location.name, text: reason, kind: "error" });
    addEvent({ tag: "interrupt", text: `${location.name}: ${reason}` });
  } catch (error) {
    addLog({ channel: location.name, text: `interrupt failed ${error.message}`, kind: "error" });
  }
}

async function interruptLocation(locationId, reason = "Interrupted by user") {
  const location = findLocation(locationId);
  if (!location) {
    return;
  }

  if (state.transport.connected && state.transport.initialized) {
    await interruptLive(location, reason);
    return;
  }

  interruptSimulation(location, reason);
}

async function createThreadForLocation(locationId) {
  const location = findLocation(locationId);
  if (!location) {
    return;
  }

  if (!state.transport.connected || !state.transport.initialized) {
    location.threadId = null;
    location.activeTurnId = null;
    renderLocations();
    addLog({ channel: location.name, text: "thread reset (simulation mode)", kind: "system" });
    return;
  }

  try {
    await ensureThreadForLocation(location, true);
  } catch (error) {
    addLog({ channel: location.name, text: `new thread failed ${error.message}`, kind: "error" });
  }
}

async function handleCommand(command, locationId) {
  const location = findLocation(locationId);
  if (!location) {
    addLog({ channel: "system", text: "Invalid location", kind: "error" });
    return;
  }

  if (location.paused) {
    addLog({ channel: location.name, text: "Location is paused. Resume first.", kind: "error" });
    addEvent({ tag: "blocked", text: `${location.name} is paused` });
    return;
  }

  addLog({ channel: "user", text: `[${location.name}] ${command}`, kind: "user" });

  if (command.startsWith("/turn/interrupt") || command === "interrupt") {
    await interruptLocation(location.id, "Interrupted via command input");
    return;
  }

  if (command.startsWith("/thread/start") && state.transport.connected && state.transport.initialized) {
    await createThreadForLocation(location.id);
    return;
  }

  if (state.transport.connected && state.transport.initialized) {
    await handleLiveCommand(location, command);
    return;
  }

  enqueueSimulation(location, command);
  renderLocations();
}

function renderLocations() {
  locationListEl.innerHTML = "";

  for (const location of locations) {
    const card = locationCardTemplate.content.firstElementChild.cloneNode(true);
    const dot = card.querySelector(".dot");
    const title = card.querySelector("h3");
    const meta = card.querySelector(".meta");
    const newThreadBtn = card.querySelector(".new-thread-btn");
    const pauseBtn = card.querySelector(".pause-btn");
    const interruptBtn = card.querySelector(".interrupt-btn");

    title.textContent = location.name;
    meta.textContent = [
      `state=${location.paused ? "paused" : (location.running ? "running" : "ready")}`,
      `queue=${location.queue}`,
      `thread=${shortId(location.threadId)}`,
      `turn=${shortId(location.activeTurnId)}`
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

    card.addEventListener("click", () => {
      setSelectedLocation(location.id);
    });

    newThreadBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await createThreadForLocation(location.id);
    });

    pauseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      location.paused = !location.paused;
      addEvent({ tag: location.paused ? "pause" : "resume", text: `${location.name} ${location.paused ? "paused" : "resumed"}` });
      addLog({ channel: location.name, text: location.paused ? "Paused by operator" : "Resumed by operator", kind: "system" });
      renderLocations();
    });

    interruptBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await interruptLocation(location.id, "Interrupted from location card");
    });

    locationListEl.appendChild(card);
  }
}

function registerEvents() {
  commandFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const command = commandInputEl.value.trim();
    if (!command) {
      return;
    }

    await handleCommand(command, locationSelectEl.value);
    commandInputEl.value = "";
    commandInputEl.focus();
  });

  locationSelectEl.addEventListener("change", () => {
    setSelectedLocation(locationSelectEl.value);
  });

  endpointInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      connectTransport();
    }
  });

  connectBtnEl.addEventListener("click", () => {
    connectTransport();
  });

  disconnectBtnEl.addEventListener("click", () => {
    disconnectTransport("Disconnected by operator");
  });

  clearLogsBtnEl.addEventListener("click", () => {
    state.logs = [];
    state.events = [];
    renderLogs();
    renderEvents();
    addLog({ channel: "system", text: "Output cleared", kind: "system" });
  });

  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      commandInputEl.value = button.dataset.quick || "";
      commandInputEl.focus();
    });
  });
}

function bootstrap() {
  endpointInputEl.value = DEFAULT_ENDPOINT;
  renderLocationOptions();
  registerEvents();
  renderLocations();
  renderLogs();
  renderEvents();
  updateRouteTarget();
  setGlobalStatus();
  updateTransportUi();

  addLog({ channel: "system", text: "Control surface initialized", kind: "system" });
  addLog({ channel: "system", text: "Use Connect for app-server, or run in simulation mode", kind: "system" });
  addEvent({ tag: "ready", text: "UI boot complete" });
}

bootstrap();
