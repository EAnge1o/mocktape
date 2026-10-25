import { EventEmitter } from "node:events";
import type { ServedRequest } from "../http/types.js";

export interface MocktapeEvents {
  /** A request finished being served; the single event everything observes. */
  served: (request: ServedRequest) => void;
  /** The mock config was reloaded (hot reload). */
  reloaded: () => void;
}

/** Typed event bus connecting the server, logger, recorder and dashboard. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof MocktapeEvents>(event: K, listener: MocktapeEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof MocktapeEvents>(event: K, listener: MocktapeEvents[K]): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof MocktapeEvents>(event: K, ...args: Parameters<MocktapeEvents[K]>): void {
    this.emitter.emit(event, ...args);
  }
}
