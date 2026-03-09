import { RPC_TIMEOUT_MS } from "./config.js";
import type { AppState, EventInput, LogInput, TransportMode } from "./types.js";
import { safeJson } from "./utils.js";

interface TransportCallbacks {
  onStateChange: () => void;
  onNotification: (method: string, params: Record<string, unknown>) => void;
  onLog: (input: LogInput) => void;
  onEvent: (input: EventInput) => void;
}

export interface TransportApi {
  connect: (endpoint: string) => void;
  disconnect: (reason?: string) => void;
  sendRpc: (method: string, params?: unknown) => Promise<unknown>;
  isLive: () => boolean;
}

export function createTransport(state: AppState, callbacks: TransportCallbacks): TransportApi {
  function setMode(mode: TransportMode): void {
    state.transport.mode = mode;
    callbacks.onStateChange();
  }

  function cleanupSocketState(mode: TransportMode): void {
    state.transport.connected = false;
    state.transport.initialized = false;
    state.transport.socket = null;
    state.transport.mode = mode;

    for (const [id, pending] of state.transport.pending) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("Socket closed"));
      state.transport.pending.delete(id);
    }

    callbacks.onStateChange();
  }

  function handleRpcResponse(message: Record<string, unknown>): void {
    const rawId = message.id;
    if (typeof rawId !== "number") {
      return;
    }

    const pending = state.transport.pending.get(rawId);
    if (!pending) {
      return;
    }

    state.transport.pending.delete(rawId);
    window.clearTimeout(pending.timeoutId);

    if (Object.prototype.hasOwnProperty.call(message, "error")) {
      const error = message.error as { message?: string };
      pending.reject(new Error(error?.message || "RPC error"));
      return;
    }

    pending.resolve(message.result);
  }

  function handleSocketMessage(raw: string): void {
    const packets = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const packet of packets) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(packet) as Record<string, unknown>;
      } catch {
        callbacks.onLog({ channel: "socket", text: `invalid json ${packet.slice(0, 120)}`, kind: "error" });
        continue;
      }

      const isResponse =
        Object.prototype.hasOwnProperty.call(message, "id") &&
        (Object.prototype.hasOwnProperty.call(message, "result") ||
          Object.prototype.hasOwnProperty.call(message, "error"));

      if (isResponse) {
        handleRpcResponse(message);
        continue;
      }

      const method = message.method;
      if (typeof method === "string") {
        const params = (message.params || {}) as Record<string, unknown>;
        callbacks.onNotification(method, params);
        continue;
      }

      callbacks.onLog({ channel: "socket", text: `unhandled packet ${safeJson(message)}`, kind: "error" });
    }
  }

  async function initializeTransport(): Promise<void> {
    const result = (await sendRpc("initialize", {
      clientInfo: {
        name: "codex-control-surface",
        version: "0.3.0",
        title: "Codex Command Grid"
      },
      capabilities: {
        experimentalApi: true
      }
    })) as { userAgent?: string };

    state.transport.initialized = true;
    callbacks.onStateChange();

    callbacks.onLog({
      channel: "socket",
      text: `initialized ${result?.userAgent || ""}`.trim(),
      kind: "system"
    });
    callbacks.onEvent({ tag: "initialize", text: "Handshake completed" });
  }

  function disconnect(reason = "Disconnected"): void {
    const socket = state.transport.socket;
    state.transport.manualClose = true;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, "client_disconnect");
    }

    cleanupSocketState("simulation");
    callbacks.onLog({ channel: "socket", text: reason, kind: "system" });
    callbacks.onEvent({ tag: "disconnect", text: reason });
  }

  function connect(endpoint: string): void {
    if (!endpoint) {
      callbacks.onLog({ channel: "socket", text: "endpoint is empty", kind: "error" });
      return;
    }

    if (state.transport.connected || state.transport.mode === "connecting") {
      disconnect("Reconnecting");
    }

    state.transport.endpoint = endpoint;
    state.transport.connected = false;
    state.transport.initialized = false;
    state.transport.manualClose = false;
    setMode("connecting");

    callbacks.onLog({ channel: "socket", text: `connecting ${endpoint}`, kind: "system" });
    callbacks.onEvent({ tag: "connect", text: `dial ${endpoint}` });

    let socket: WebSocket;
    try {
      socket = new WebSocket(endpoint);
    } catch (error) {
      setMode("error");
      callbacks.onLog({
        channel: "socket",
        text: `connect failed ${(error as Error).message}`,
        kind: "error"
      });
      return;
    }

    state.transport.socket = socket;

    socket.addEventListener("open", async () => {
      if (state.transport.socket !== socket) {
        return;
      }

      state.transport.connected = true;
      setMode("live");
      callbacks.onLog({ channel: "socket", text: "socket open", kind: "system" });

      try {
        await initializeTransport();
      } catch (error) {
        setMode("error");
        callbacks.onLog({
          channel: "socket",
          text: `initialize failed ${(error as Error).message}`,
          kind: "error"
        });
      }
    });

    socket.addEventListener("message", (event) => {
      if (state.transport.socket !== socket) {
        return;
      }
      handleSocketMessage(String(event.data));
    });

    socket.addEventListener("error", () => {
      if (state.transport.socket !== socket) {
        return;
      }
      setMode("error");
      callbacks.onLog({ channel: "socket", text: "socket error", kind: "error" });
    });

    socket.addEventListener("close", () => {
      if (state.transport.socket !== socket) {
        return;
      }

      const closedByUser = state.transport.manualClose;
      cleanupSocketState(closedByUser ? "simulation" : "error");

      if (!closedByUser) {
        callbacks.onLog({ channel: "socket", text: "socket closed", kind: "error" });
        callbacks.onEvent({ tag: "disconnect", text: "connection lost" });
      }

      state.transport.manualClose = false;
    });
  }

  function sendRpc(method: string, params: unknown = {}): Promise<unknown> {
    const socket = state.transport.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Socket is not connected"));
    }

    const id = state.transport.nextId;
    state.transport.nextId += 1;

    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        state.transport.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, RPC_TIMEOUT_MS);

      state.transport.pending.set(id, { resolve, reject, timeoutId, method });

      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        window.clearTimeout(timeoutId);
        state.transport.pending.delete(id);
        reject(error);
      }
    });
  }

  function isLive(): boolean {
    return state.transport.connected && state.transport.initialized;
  }

  return {
    connect,
    disconnect,
    sendRpc,
    isLive
  };
}
