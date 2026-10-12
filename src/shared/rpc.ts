/**
 * Minimal typed request/response RPC over postMessage plus one-way events.
 * Used between a document session (main thread) and its worker.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiShape = Record<string, (params: any) => any>;

export interface RpcRequest {
  id: number;
  method: string;
  params: unknown;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export interface RpcEvent {
  event: string;
  data: unknown;
}

export interface MessagePort_ {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
}

export class RpcClient<Api extends ApiShape, Events extends Record<string, unknown>> {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(private port: MessagePort_) {
    port.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as RpcResponse & RpcEvent;
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error !== undefined) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (typeof msg.event === 'string') {
        this.listeners.get(msg.event)?.forEach((fn) => fn(msg.data));
      }
    });
  }

  call<K extends keyof Api & string>(method: K, params: Parameters<Api[K]>[0], transfer: Transferable[] = []): Promise<Awaited<ReturnType<Api[K]>>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ id, method, params } satisfies RpcRequest, transfer);
    });
  }

  /** Fire-and-forget call (no response tracking). */
  notify<K extends keyof Api & string>(method: K, params: Parameters<Api[K]>[0]): void {
    this.port.postMessage({ id: -1, method, params } satisfies RpcRequest);
  }

  on<K extends keyof Events & string>(event: K, fn: (data: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (data: unknown) => void);
    return () => set!.delete(fn as (data: unknown) => void);
  }

  rejectAll(reason: string): void {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }
}

export function serve<Api extends ApiShape>(port: MessagePort_, api: Api): void {
  port.addEventListener('message', async (ev: MessageEvent) => {
    const req = ev.data as RpcRequest;
    if (typeof req?.method !== 'string') return;
    const fn = api[req.method];
    if (!fn) {
      if (req.id >= 0) port.postMessage({ id: req.id, error: `Unknown method ${req.method}` } satisfies RpcResponse);
      return;
    }
    try {
      const result = await fn(req.params);
      if (req.id >= 0) port.postMessage({ id: req.id, result } satisfies RpcResponse);
    } catch (err) {
      if (req.id >= 0) port.postMessage({ id: req.id, error: (err as Error)?.message ?? String(err) } satisfies RpcResponse);
    }
  });
}

export function emit(port: MessagePort_, event: string, data: unknown, transfer: Transferable[] = []): void {
  port.postMessage({ event, data } satisfies RpcEvent, transfer);
}
