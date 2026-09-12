/**
 * Browser-side calls into this app's own route handlers.
 *
 * No base URL: the API is served from the same origin as the page, so a
 * relative path is correct in development, in preview and in production
 * without a build-time variable to set or get wrong. Nothing here sets
 * `credentials` either — same-origin requests send cookies by default, and the
 * Clerk session rides along without the client naming it.
 */
import type { StormImpactResponse } from './api-types';

/** Carries the status code so a caller can tell 401 from 500 without parsing prose. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  // The server explains its own failures — "radiusKm must be between 0 and 80"
  // is worth showing a user. Replacing it with a generic message throws away
  // the only part of the response that tells them what to do next.
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // A non-JSON error body is nothing to add; the status code stands.
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export function getStormImpacts(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal
): Promise<StormImpactResponse> {
  const query = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radiusKm: String(radiusKm),
  });
  return request<StormImpactResponse>(`/api/storms?${query}`, { signal });
}

export function setLeadStatus(
  parcelId: string,
  status: string
): Promise<{ lead: { status: string } }> {
  return request(`/api/leads/${encodeURIComponent(parcelId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
