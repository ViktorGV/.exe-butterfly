// Tiny typed event emitter. Pure.

export type Listener<T> = (payload: T) => void;

export interface Emitter<E> {
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(evt: K, fn: Listener<E[K]>): () => void;
  emit<K extends keyof E>(evt: K, payload: E[K]): void;
  clear(): void;
}

export function createEmitter<E>(onError: (err: unknown) => void = console.error): Emitter<E> {
  const map = new Map<keyof E, Set<Listener<never>>>();
  return {
    on(evt, fn) {
      let set = map.get(evt);
      if (!set) map.set(evt, (set = new Set()));
      set.add(fn as Listener<never>);
      return () => {
        set.delete(fn as Listener<never>);
      };
    },
    emit(evt, payload) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of set) {
        try {
          (fn as Listener<E[typeof evt]>)(payload);
        } catch (err) {
          onError(err); // one bad listener must not stop the others
        }
      }
    },
    clear() {
      map.clear();
    },
  };
}
