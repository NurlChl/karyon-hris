/**
 * Thin fetch wrapper for the browser so every page reads API responses the same
 * way: it unwraps `{ success, data, message }` and turns `{ success:false, error }`
 * into a real thrown Error carrying the server's Indonesian message and code.
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number };
  error?: { code: string; message: string; details?: unknown };
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  init?: RequestInit
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi.",
      0
    );
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      `Server mengembalikan respons yang tidak dikenali (HTTP ${res.status}).`,
      res.status
    );
  }

  if (!res.ok || payload.success === false) {
    throw new ApiError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? `Permintaan gagal (HTTP ${res.status}).`,
      res.status,
      payload.error?.details
    );
  }

  return payload;
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>("GET", url, undefined, init),
  post: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("POST", url, body, init),
  put: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("PUT", url, body, init),
  patch: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("PATCH", url, body, init),
  delete: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("DELETE", url, body, init),
};

/** Narrows an unknown catch value to a human-readable Indonesian message. */
export function errorMessage(err: unknown, fallback = "Terjadi kesalahan tak terduga."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
