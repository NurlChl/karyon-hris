import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestApiKey {
  keyId: string;
  userId: string;
  scopes: string[];
}

interface RequestContext {
  apiKey?: RequestApiKey;
}

/**
 * Per-request state shared by the guard and the RBAC check. The holder object
 * is created by `wrapRouteHandler`; the guard fills it when a request
 * authenticates with an API key, so every later `checkPermission` for that
 * user in the same request is limited to the key scopes.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({}, fn);
}

/** Returns false when no request context exists; callers must then refuse the key. */
export function bindApiKey(key: RequestApiKey): boolean {
  const context = storage.getStore();
  if (!context) return false;
  context.apiKey = key;
  return true;
}

export function currentApiKey(): RequestApiKey | undefined {
  return storage.getStore()?.apiKey;
}
