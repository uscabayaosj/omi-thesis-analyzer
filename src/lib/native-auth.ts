import { createHash, timingSafeEqual } from "node:crypto";
import { getStore, withTimeout, type Sql } from "./kv";

export interface NativeDevice {
  installation_id: string;
  label: string;
  created_at: string | Date;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
}

export type NativeAuthorization =
  | { ok: true; device: Pick<NativeDevice, "installation_id" | "label"> }
  | { ok: false; status: 401 | 503; error: string };

let schemaReady: Promise<void> | null = null;

async function ensureNativeDeviceSchema(sql: Sql): Promise<void> {
  await withTimeout(sql`
    CREATE TABLE IF NOT EXISTS trace_native_devices (
      installation_id UUID PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `);
  // Dedicated personal deployments may have only one active installation.
  // A unique index enforces this even when enrollment requests race.
  // Leave legacy deployments unchanged unless explicitly enabled.
  if (process.env.TRACE_SINGLE_PERSON_WORKSPACE === "1") {
    await withTimeout(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS trace_native_one_active_installation
      ON trace_native_devices ((true)) WHERE revoked_at IS NULL
    `);
  }
}

export async function ensureNativeDeviceSchemaOnce(sql: Sql): Promise<void> {
  if (!schemaReady) schemaReady = ensureNativeDeviceSchema(sql);
  try {
    await schemaReady;
  } catch (error) {
    schemaReady = null;
    throw error;
  }
}

function bearerValue(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function isNativeEnrollmentAuthorized(request: Request, expected: string | undefined): boolean {
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) return false;
  const actual = Buffer.from(bearerValue(request), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function isNativeTokenFormatValid(token: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    return Buffer.from(token, "base64url").length === 32;
  } catch {
    return false;
  }
}

export function hashNativeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function authorizeNativeDevice(request: Request): Promise<NativeAuthorization> {
  const token = bearerValue(request);
  if (!isNativeTokenFormatValid(token)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  const sql = getStore();
  if (!sql) return { ok: false, status: 503, error: "Native data service is not configured." };

  try {
    await ensureNativeDeviceSchemaOnce(sql);
    const rows = (await withTimeout(sql`
      UPDATE trace_native_devices
      SET last_used_at = now()
      WHERE token_hash = ${hashNativeToken(token)} AND revoked_at IS NULL
      RETURNING installation_id, label
    `)) as Pick<NativeDevice, "installation_id" | "label">[];
    if (!rows[0]) return { ok: false, status: 401, error: "Unauthorized." };
    return { ok: true, device: rows[0] };
  } catch (error) {
    console.error("native device authorization failed:", error);
    return { ok: false, status: 503, error: "Native data service is unavailable." };
  }
}

export class NativeWorkspaceEnrollmentLimitError extends Error {
  constructor() { super("This private workspace already has an enrolled iPhone. Revoke that installation before enrolling a replacement."); }
}

export async function enrollNativeDevice(input: {
  installationId: string;
  label: string;
  tokenHash: string;
}): Promise<NativeDevice> {
  const sql = getStore();
  if (!sql) throw new Error("store not configured");
  await ensureNativeDeviceSchemaOnce(sql);
  let rows: NativeDevice[];
  try {
    rows = (await withTimeout(sql`
    INSERT INTO trace_native_devices (installation_id, label, token_hash)
    VALUES (${input.installationId}, ${input.label}, ${input.tokenHash})
    ON CONFLICT (installation_id) DO UPDATE SET
      label = EXCLUDED.label,
      token_hash = EXCLUDED.token_hash,
      created_at = now(),
      last_used_at = NULL,
      revoked_at = NULL
    RETURNING installation_id, label, created_at, last_used_at, revoked_at
  `)) as NativeDevice[];
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError.code === "23505" && databaseError.constraint === "trace_native_one_active_installation") {
      throw new NativeWorkspaceEnrollmentLimitError();
    }
    throw error;
  }
  return rows[0];
}

export async function listNativeDevices(): Promise<NativeDevice[]> {
  const sql = getStore();
  if (!sql) throw new Error("store not configured");
  await ensureNativeDeviceSchemaOnce(sql);
  return (await withTimeout(sql`
    SELECT installation_id, label, created_at, last_used_at, revoked_at
    FROM trace_native_devices
    ORDER BY created_at DESC
  `)) as NativeDevice[];
}

export async function revokeNativeDevice(installationId: string): Promise<boolean> {
  const sql = getStore();
  if (!sql) throw new Error("store not configured");
  await ensureNativeDeviceSchemaOnce(sql);
  const rows = (await withTimeout(sql`
    UPDATE trace_native_devices
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE installation_id = ${installationId}::uuid
    RETURNING installation_id
  `)) as { installation_id: string }[];
  return rows.length > 0;
}
