import { timingSafeEqual } from "node:crypto";

/** Bearer check that leaks nothing through timing; false when unconfigured. */
export function isBearerAuthorized(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
