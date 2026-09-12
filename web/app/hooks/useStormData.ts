'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStormImpacts, ApiError } from '@/lib/api';
import type { Storm, PropertyLead } from '@/lib/api-types';

/**
 * Storm impacts around a point, kept in step with a moving centre and radius.
 *
 * The debounce and the abort are not optimisations. A radius slider fires a
 * change per step, so one drag issues dozens of requests, and without
 * cancelling the earlier ones a slow answer for 2km can land after a fast one
 * for 40km and overwrite it — the map would then show a different radius from
 * the one the control reports.
 */
export function useStormData(
  lat: number,
  lng: number,
  radiusKm: number,
  debounceMs = 250
) {
  const [storms, setStorms] = useState<Storm[]>([]);
  const [properties, setProperties] = useState<PropertyLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (a: number, b: number, r: number) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError('');
    try {
      const data = await getStormImpacts(a, b, r, controller.signal);
      setStorms(data.storms);
      setProperties(data.properties);
      setLoading(false);
    } catch (err) {
      // An abort is this hook superseding its own request, not a failure
      // anyone needs to read about.
      if (controller.signal.aborted) return;
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Failed to load storm data'
      );
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(lat, lng, radiusKm), debounceMs);
    return () => {
      clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [lat, lng, radiusKm, debounceMs, load]);

  return { storms, properties, loading, error, reload: () => load(lat, lng, radiusKm) };
}
