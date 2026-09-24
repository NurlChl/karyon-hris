export interface ApiKeyIdentity {
  keyId: string;
  userId: string;
  scopes: string[];
}

/**
 * Community has no API key authentication; the Pro distribution replaces this
 * module. Requests that present a key are rejected instead of being treated as
 * anonymous or as a session.
 */
export async function authenticateApiKey(_req: Request, _token: string): Promise<ApiKeyIdentity> {
  const { Forbidden } = await import("@/lib/guard");
  throw Forbidden("Akses API dengan API key tersedia pada HRIS Pro dengan lisensi aktif.");
}
