import { NextResponse } from "next/server";

/**
 * Address search, proxied to OpenStreetMap's Nominatim.
 *
 * Server-side rather than called from the browser for two reasons: Nominatim's
 * usage policy requires an identifying User-Agent (a browser can't set one),
 * and it doesn't serve permissive CORS headers. Same data source as the map
 * tiles the app already uses, so no new provider or key enters the stack.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "TRACE/1.0 (personal research tool; https://omi-thesis-analyzer.vercel.app)";

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  // Nominatim asks callers not to send unbounded queries; a single character
  // matches most of the planet and is never a real search.
  if (q.length < 3) return NextResponse.json({ results: [] });

  const url = `${NOMINATIM}?${new URLSearchParams({
    q,
    format: "json",
    limit: "6",
    addressdetails: "0",
  })}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      // Nominatim is a free community service; a slow response should fail the
      // search box, not hold a function open for the platform's full timeout.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Address search is unavailable right now.", results: [] },
        { status: 502 }
      );
    }
    const raw: unknown = await res.json();
    const results: GeocodeResult[] = Array.isArray(raw)
      ? raw
          .map((r) => {
            const row = r as { display_name?: unknown; lat?: unknown; lon?: unknown };
            const lat = Number(row.lat);
            const lng = Number(row.lon);
            if (typeof row.display_name !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
              return null;
            }
            return { label: row.display_name, lat, lng };
          })
          .filter((r): r is GeocodeResult => r !== null)
      : [];

    return NextResponse.json(
      { results },
      // Repeat searches for the same string are common while typing; a short
      // shared cache keeps this well inside Nominatim's rate limits.
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Address search timed out.", results: [] },
      { status: 504 }
    );
  }
}
