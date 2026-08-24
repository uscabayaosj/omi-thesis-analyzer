// src/app/api/push/check-rollup/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getStore, ensureSchema, getNamespaceData } from "@/lib/kv";
import { listSubscriptions, removeSubscription } from "@/lib/push-store";

/**
 * Cron target (see vercel.json — runs daily at 21:00 UTC, approximating
 * 9:00 PM Europe/London; drifts ~1hr during British Summer Time, an
 * approved approximation per the spec).
 *
 * Auth: Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on
 * requests it makes to a configured cron path. Anything else is rejected —
 * this route sends a push to every stored subscription and must not be
 * publicly triggerable.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ sent: false, reason: "not configured" });
  }

  // "Today" in Europe/London, as YYYY-MM-DD — matches the day-key format
  // StoredRollup is keyed by in the omi-adhd-rollups namespace.
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  let rollups: Record<string, unknown>;
  try {
    await ensureSchema(sql);
    const data = await getNamespaceData(sql, "omi-adhd-rollups");
    rollups = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch (err) {
    console.error("check-rollup: failed to read rollups namespace:", err);
    return NextResponse.json({ sent: false, reason: "read failed" }, { status: 500 });
  }

  if (todayKey in rollups) {
    return NextResponse.json({ sent: false, reason: "already run" });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error("check-rollup: VAPID env vars not configured");
    return NextResponse.json({ sent: false, reason: "vapid not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const subscriptions = await listSubscriptions();
  const payload = JSON.stringify({
    title: "TRACE",
    body: "You haven't run today's rollup yet.",
    url: "/rollup",
  });

  let deliveredCount = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      deliveredCount++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(sub.endpoint).catch((e) =>
          console.error(`check-rollup: failed to remove dead subscription ${sub.endpoint}:`, e)
        );
      } else {
        console.error(`check-rollup: send failed for ${sub.endpoint}:`, err);
      }
    }
  }

  return NextResponse.json({
    sent: true,
    subscriptionCount: subscriptions.length,
    deliveredCount,
  });
}
