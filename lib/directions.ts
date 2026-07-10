/**
 * Google Directions API (HTTP) + Geocoding API.
 * Used for pedestrian turn-by-turn navigation.
 *
 * Two route modes:
 *   normal    — shortest walking route
 *   accessible — walking, avoid=ferries|indoor (no steps avoidance, as
 *                Google Directions API does not support avoid=steps on foot;
 *                instead we request "walking" mode which prefers sidewalks)
 *
 * Requires: Directions API + Geocoding API enabled in GCP.
 */

import { Perf } from './perf';

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export type LatLng = { lat: number; lng: number };

export type RouteStep = {
  instruction: string;   // HTML-stripped human-readable instruction
  distanceM: number;     // metres
  durationSec: number;   // seconds
  endLocation: LatLng;
  maneuver: string;      // e.g. "turn-left", "straight", ""
};

export type RouteResult = {
  steps: RouteStep[];
  totalDistanceM: number;
  totalDurationSec: number;
  overviewPolyline: string; // encoded polyline
  warnings: string[];
};

/** Strip HTML tags returned by the Directions API */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Geocode a free-form address to LatLng */
export async function geocodeAddress(address: string): Promise<LatLng> {
  const url =
    `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(`Geocoding: ${json.status}`);
  const loc = json.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

/**
 * Fetch a walking route.
 * @param origin      GPS coordinates of user
 * @param destination LatLng or address string
 * @param accessible  If true, requests transit-friendly alternatives
 * @param lang        Language for instruction text ('ru' | 'en')
 */
export async function getDirections(
  origin: LatLng,
  destination: LatLng | string,
  accessible: boolean,
  lang: 'ru' | 'en' = 'ru'
): Promise<RouteResult> {
  const tRoute = Perf.start();
  let destLatLng: LatLng;
  if (typeof destination === 'string') {
    destLatLng = await geocodeAddress(destination);
  } else {
    destLatLng = destination;
  }

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destLatLng.lat},${destLatLng.lng}`,
    mode: 'walking',
    language: lang,
    alternatives: accessible ? 'true' : 'false',
    // avoid=indoor reduces underground transitions for accessible mode
    ...(accessible ? { avoid: 'indoor|ferries' } : {}),
    key: GOOGLE_KEY,
  });

  const res = await fetch(`${DIRECTIONS_URL}?${params}`);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(`Directions: ${json.status}`);

  // Pick the first route (accessible mode sometimes returns alternatives — pick shortest)
  const routes = json.routes as any[];
  let route = routes[0];
  if (accessible && routes.length > 1) {
    // prefer route with fewest steps (fewer turns = simpler for blind user)
    route = routes.reduce((best: any, r: any) =>
      r.legs[0].steps.length < best.legs[0].steps.length ? r : best
    );
  }

  const leg = route.legs[0];

  const steps: RouteStep[] = leg.steps.map((s: any) => ({
    instruction: stripHtml(s.html_instructions),
    distanceM: s.distance?.value ?? 0,
    durationSec: s.duration?.value ?? 0,
    endLocation: { lat: s.end_location.lat, lng: s.end_location.lng },
    maneuver: s.maneuver ?? '',
  }));

  Perf.end('directions_rtt', tRoute);
  return {
    steps,
    totalDistanceM: leg.distance?.value ?? 0,
    totalDurationSec: leg.duration?.value ?? 0,
    overviewPolyline: route.overview_polyline?.points ?? '',
    warnings: route.warnings ?? [],
  };
}

/** Haversine distance in metres between two coordinates */
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

/** Decode a Google encoded polyline to LatLng[] */
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
