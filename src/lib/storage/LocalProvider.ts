import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { contentTypeForKey, type StorageProvider } from "./StorageProvider";

/**
 * Disk-backed storage for single-server / development deployments.
 *
 * The base directory defaults to `./storage/uploads`, which is deliberately
 * **outside** `public/`. Files under `public/` are served statically by
 * Next.js, which previously made every attendance selfie and payslip readable
 * by anyone who could guess the path — the signed URLs were decorative. Now the
 * only way in is `/api/v1/storage/secure`, which checks both the session and the
 * HMAC signature.
 */
export class LocalProvider implements StorageProvider {
  private baseDir: string;
  private signingSecretValue: string | null = null;
  private encryptionKeyValue: Buffer | null = null;

  constructor() {
    this.baseDir = process.env.LOCAL_STORAGE_PATH || "./storage/uploads";
  }

  /** Resolve secrets lazily: production builds must not require runtime keys. */
  private signingSecret(): string {
    if (this.signingSecretValue) return this.signingSecretValue;
    const secret =
      process.env.STORAGE_SIGNING_SECRET ||
      (process.env.NODE_ENV !== "production"
        ? process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
        : undefined);
    if (!secret) {
      throw new Error(
        process.env.NODE_ENV === "production"
          ? "STORAGE_SIGNING_SECRET khusus wajib diset di produksi."
          : "Secret penyimpanan belum diset — URL file tidak dapat ditandatangani."
      );
    }
    this.signingSecretValue = secret;
    return secret;
  }

  private fileEncryptionKey(): Buffer {
    if (this.encryptionKeyValue) return this.encryptionKeyValue;
    const encryptionSecret =
      process.env.ENCRYPTION_KEY ||
      (process.env.NODE_ENV !== "production"
        ? process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
        : undefined);
    if (!encryptionSecret) {
      throw new Error(
        process.env.NODE_ENV === "production"
          ? "ENCRYPTION_KEY wajib diset untuk mengenkripsi file lokal di produksi."
          : "ENCRYPTION_KEY atau secret development wajib diset untuk penyimpanan lokal."
      );
    }
    this.encryptionKeyValue = crypto
      .createHash("sha256")
      .update(`${encryptionSecret}:local-file-at-rest:v1`)
      .digest();
    return this.encryptionKeyValue;
  }

  /** Resolves a key inside the base dir, refusing traversal. */
  private resolve(key: string): string {
    const base = path.resolve(/* turbopackIgnore: true */ process.cwd(), this.baseDir);
    const full = path.resolve(/* turbopackIgnore: true */ base, key);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error("Percobaan akses direktori di luar area penyimpanan ditolak.");
    }
    return full;
  }

  async upload(file: Buffer | Blob, key: string, _mimeType?: string): Promise<string> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });

    const buffer =
      file instanceof Buffer ? file : Buffer.from(await (file as Blob).arrayBuffer());

    await fs.writeFile(full, this.encryptBuffer(buffer));
    return key.replace(/\\/g, "/");
  }

  getUrl(key: string): string {
    // Even "non-sensitive" local files go through the authenticated route;
    // nothing on disk is publicly reachable by design.
    return `/api/v1/storage/secure?key=${encodeURIComponent(key.replace(/\\/g, "/"))}`;
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const cleanKey = key.replace(/\\/g, "/");
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = this.sign(cleanKey, expires);
    return `/api/v1/storage/secure?key=${encodeURIComponent(cleanKey)}&expires=${expires}&sig=${sig}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async read(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const stored = await fs.readFile(this.resolve(key));
    const buffer = this.decryptBuffer(stored);
    return { buffer, contentType: contentTypeForKey(key) };
  }

  /** Binary envelope: magic (8) + IV (12) + GCM tag (16) + ciphertext. */
  private encryptBuffer(plain: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.fileEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([
      Buffer.from("HRISENC1", "ascii"),
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  }

  private decryptBuffer(stored: Buffer): Buffer {
    const magic = Buffer.from("HRISENC1", "ascii");
    // Backward compatibility: files written before encrypted local storage are
    // still readable and become encrypted the next time they are replaced.
    if (!stored.subarray(0, 8).equals(magic)) return stored;
    if (stored.length < 36) throw new Error("File terenkripsi tidak lengkap.");

    const iv = stored.subarray(8, 20);
    const tag = stored.subarray(20, 36);
    const ciphertext = stored.subarray(36);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.fileEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private sign(key: string, expires: number): string {
    return crypto
      .createHmac("sha256", this.signingSecret())
      .update(`${key}:${expires}`)
      .digest("hex");
  }

  /** Verifies a signed link; false when expired, malformed, or tampered with. */
  verifySignature(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || Date.now() / 1000 > expires) return false;
    const expected = this.sign(key.replace(/\\/g, "/"), expires);
    if (!/^[0-9a-f]{64}$/.test(signature)) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
