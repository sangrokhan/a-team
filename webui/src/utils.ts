export function createId(): string {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour12: false });
}

export function shortId(value: string | null | undefined): string {
  if (!value || typeof value !== "string") {
    return "-";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}..${value.slice(-4)}`;
}

export function safeJson(value: unknown, limit = 170): string {
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
