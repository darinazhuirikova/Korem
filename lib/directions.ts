/**
 * Routing module — Google Directions API + OpenRouteService wheelchair routing.
 *
 * getDirectionsWithFallback() is the primary entry point:
 *   1. If EXPO_PUBLIC_ORS_KEY is set and accessible=true  → try ORS wheelchair route.
 *   2. Falls back to Google Directions on ORS failure or missing key.
 *
 * getDirections() remains available for Google-only callers.
 *
 * All network calls use withTimeout + withRetry (Phase 5 error handling).
 */

import { Perf } from './perf';
import { withTimeout, withRetry } from './errorHandler';

const GOOGLE_KEY    = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
const ORS_KEY       = process.env.EXPO_PUBLIC_ORS_KEY   ?? '';
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_URL    = 'https://maps.googleapis.com/maps/api/geocode/json';
const ORS_URL        = 'https://api.openrouteservice.org/v2/directions/wheelchair';

export type LatLng = { lat: number; lng: number };

export type RouteStep = {
  instruction: string;
  distanceM: number;
  durationSec: number;
  endLocation: LatLng;
  maneuver: string;
};

export type RouteResult = {
  steps: RouteStep[];
  totalDistanceM: number;
  totalDurationSec: number;
  overviewPolyline: string;
  warnings: string[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Encode LatLng[] to Google-format encoded polyline string. */
function encodePolyline(points: LatLng[]): string {
  function encodeVal(v: number): string {
    let n = Math.round(v * 1e5);
    n = n < 0 ? ~(n << 1) : n << 1;
    let s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  }
  let result = '', prevLat = 0, prevLng = 0;
  for (const p of points) {
    result += encodeVal(p.lat - prevLat) + encodeVal(p.lng - prevLng);
    prevLat = p.lat; prevLng = p.lng;
  }
  return result;
}

// ORS step type → maneuver string mapping (subset of ORS instruction types)
const ORS_MANEUVER: Record<number, string> = {
  0: 'turn-left', 1: 'turn-right', 2: 'turn-sharp-left', 3: 'turn-sharp-right',
  4: 'turn-slight-left', 5: 'turn-slight-right', 6: 'straight',
  7: 'roundabout', 8: 'exit-roundabout', 9: 'uturn',
  11: 'depart', 12: 'keep-left', 13: 'keep-right',
};

// ── Geocoding ─────────────────────────────────────────────────────────────────

export async function geocodeAddress(address: string): Promise<LatLng> {
  return withRetry(async () => {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${GOOGLE_KEY}`;
    const res = await withTimeout(fetch(url), 8_000);
    if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'OK') throw new Error(`Geocoding: ${json.status}`);
    const loc = json.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }, 1, 1_000);
}

// ── Google Directions ─────────────────────────────────────────────────────────

export async function getDirections(
  origin: LatLng,
  destination: LatLng | string,
  accessible: boolean,
  lang: 'ru' | 'en' = 'ru',
): Promise<RouteResult> {
  const tRoute = Perf.start();
  let destLatLng: LatLng;
  if (typeof destination === 'string') {
    destLatLng = await geocodeAddress(destination);
  } else {
    destLatLng = destination;
  }

  return withRetry(async () => {
    const params = new URLSearchParams({
      origin:      `${origin.lat},${origin.lng}`,
      destination: `${destLatLng.lat},${destLatLng.lng}`,
      mode:        'walking',
      language:    lang,
      alternatives: accessible ? 'true' : 'false',
      ...(accessible ? { avoid: 'indoor|ferries' } : {}),
      key: GOOGLE_KEY,
    });

    const res = await withTimeout(fetch(`${DIRECTIONS_URL}?${params}`), 10_000);
    if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'OK') throw new Error(`Directions: ${json.status}`);

    const routes = json.routes as any[];
    let route = routes[0];
    if (accessible && routes.length > 1) {
      route = routes.reduce((best: any, r: any) =>
        r.legs[0].steps.length < best.legs[0].steps.length ? r : best
      );
    }

    const leg = route.legs[0];
    const steps: RouteStep[] = leg.steps.map((s: any) => ({
      instruction: stripHtml(s.html_instructions),
      distanceM:   s.distance?.value ?? 0,
      durationSec: s.duration?.value ?? 0,
      endLocation: { lat: s.end_location.lat, lng: s.end_location.lng },
      maneuver:    s.maneuver ?? '',
    }));

    Perf.end('directions_rtt', tRoute);
    return {
      steps,
      totalDistanceM:  leg.distance?.value ?? 0,
      totalDurationSec: leg.duration?.value ?? 0,
      overviewPolyline: route.overview_polyline?.points ?? '',
      warnings: route.warnings ?? [],
    };
  }, 1, 1_000);
}

// ── ORS Wheelchair Directions ─────────────────────────────────────────────────

async function getDirectionsORS(
  origin: LatLng,
  destination: LatLng,
  lang: 'ru' | 'en',
): Promise<RouteResult> {
  const tRoute = Perf.start();
  const body = {
    coordinates: [
      [origin.lng,      origin.lat],
      [destination.lng, destination.lat],
    ],
    language:   lang,
    preference: 'recommended',
  };

  // No retry here — caller (getDirectionsWithFallback) falls through to Google on failure
  const res = await withTimeout(
    fetch(ORS_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ORS_KEY}`,
      },
      body: JSON.stringify(body),
    }),
    10_000,
  );
  if (!res.ok) throw new Error(`ORS HTTP ${res.status}`);
  const json = await res.json();

  const feature = json?.features?.[0];
  if (!feature) throw new Error('ORS: no route');
  const segment = feature.properties?.segments?.[0];
  if (!segment) throw new Error('ORS: no segment');

  // GeoJSON coords are [lng, lat]
  const coords: LatLng[] = (feature.geometry?.coordinates ?? []).map(
    ([lng, lat]: [number, number]) => ({ lat, lng }),
  );

  const steps: RouteStep[] = (segment.steps ?? []).map((s: any) => {
    const wpEnd = Math.min(s.way_points?.[1] ?? 0, coords.length - 1);
    return {
      instruction: s.instruction ?? '',
      distanceM:   Math.round(s.distance ?? 0),
      durationSec: Math.round(s.duration ?? 0),
      endLocation: coords[wpEnd] ?? destination,
      maneuver:    ORS_MANEUVER[s.type ?? -1] ?? '',
    };
  });

  const summary = feature.properties?.summary ?? {};
  Perf.end('ors_rtt', tRoute);
  return {
    steps,
    totalDistanceM:   Math.round(summary.distance ?? 0),
    totalDurationSec: Math.round(summary.duration ?? 0),
    overviewPolyline: encodePolyline(coords),
    warnings: [],
  };
}

// ── Primary entry point ───────────────────────────────────────────────────────

/**
 * Fetch a route, preferring ORS wheelchair routing when accessible=true and
 * EXPO_PUBLIC_ORS_KEY is configured.  Falls back to Google on ORS failure.
 *
 * The returned object extends RouteResult with a `source` discriminator.
 */
export async function getDirectionsWithFallback(
  origin: LatLng,
  destination: LatLng | string,
  accessible: boolean,
  lang: 'ru' | 'en' = 'ru',
): Promise<RouteResult & { source: 'ors' | 'google' }> {
  // Resolve string address once (both providers need LatLng)
  const destLatLng: LatLng =
    typeof destination === 'string'
      ? await geocodeAddress(destination)
      : destination;

  // Try ORS wheelchair routing first (only in accessible mode with key set)
  if (ORS_KEY && accessible) {
    try {
      const result = await getDirectionsORS(origin, destLatLng, lang);
      return { ...result, source: 'ors' };
    } catch {
      // ORS unavailable — fall through to Google silently
    }
  }

  const result = await getDirections(origin, destLatLng, accessible, lang);
  return { ...result, source: 'google' };
}

// ── Utility functions ─────────────────────────────────────────────────────────

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
