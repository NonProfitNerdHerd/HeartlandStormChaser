import type { EventSeverity, ListenerEvent } from "./types.js";

const MAX_EVENTS = 200;

export class EventLog {
  private events: ListenerEvent[] = [];

  push(category: string, message: string, severity: EventSeverity = "information"): ListenerEvent {
    const entry: ListenerEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      message,
      severity,
    };
    this.events.unshift(entry);
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    return entry;
  }

  list(limit = 50): ListenerEvent[] {
    return this.events.slice(0, Math.max(1, Math.min(limit, MAX_EVENTS)));
  }
}
