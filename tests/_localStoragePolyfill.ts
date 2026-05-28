/**
 * happy-dom v20 doesn't expose localStorage on window/globalThis in vitest by default,
 * and Node 26's built-in localStorage requires --localstorage-file. Tests that need
 * persistence install this lightweight in-memory polyfill onto globalThis.
 */

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

export function installLocalStoragePolyfill(): void {
  if (typeof globalThis.localStorage !== "undefined") return;
  const instance = new InMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: instance,
  });
  // 让 vi.spyOn(Storage.prototype, ...) 也能用
  Object.defineProperty(globalThis, "Storage", {
    configurable: true,
    writable: true,
    value: InMemoryStorage,
  });
}
