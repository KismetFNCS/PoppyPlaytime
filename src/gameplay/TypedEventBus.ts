export type EventListener<TPayload> = (payload: TPayload) => void;

/**
 * Strongly typed synchronous publish/subscribe bus. `TEventMap` maps event names to payload types,
 * so `emit('x', payload)` and `on('x', listener)` are checked against the same declaration.
 */
export class TypedEventBus<TEventMap extends object> {
  private readonly listeners: { [EventName in keyof TEventMap]?: Set<EventListener<TEventMap[EventName]>> } = {};

  public on<EventName extends keyof TEventMap>(eventName: EventName, listener: EventListener<TEventMap[EventName]>): () => void {
    let set: Set<EventListener<TEventMap[EventName]>> | undefined = this.listeners[eventName];
    if (set === undefined) {
      set = new Set();
      this.listeners[eventName] = set;
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  public emit<EventName extends keyof TEventMap>(eventName: EventName, payload: TEventMap[EventName]): void {
    const set: Set<EventListener<TEventMap[EventName]>> | undefined = this.listeners[eventName];
    if (set === undefined) {
      return;
    }
    // Snapshot so listeners may unsubscribe during dispatch.
    for (const listener of [...set]) {
      listener(payload);
    }
  }

  public clear(): void {
    for (const eventName of Object.keys(this.listeners) as Array<keyof TEventMap>) {
      this.listeners[eventName]?.clear();
    }
  }
}
