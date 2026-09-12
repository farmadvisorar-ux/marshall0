'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { MappableArea } from '@/lib/db';

/**
 * Leaflet reaches for `window` at import time, so the map can only be loaded in
 * the browser. That import has to happen inside a client component — `ssr:
 * false` is not allowed from a server component in the App Router.
 */
const StormMap = dynamic(() => import('../components/map/StormMap').then((m) => m.StormMap), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 animate-pulse" />
  ),
});

export function MapPanel({ areas }: { areas: MappableArea[] }) {
  const [activeId, setActiveId] = useState(areas[0]?.id ?? '');
  const area = areas.find((a) => a.id === activeId) ?? areas[0];

  if (!area) return null;

  return (
    <div className="space-y-4">
      {areas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveId(a.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                a.id === area.id
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400'
              }`}
            >
              {a.name}
              <span className="ml-2 opacity-70">{a.parcels.toLocaleString('en-US')}</span>
            </button>
          ))}
        </div>
      )}

      {/* Remounted per area: Leaflet reads `center` once, at construction. */}
      <StormMap key={area.id} centerLat={area.lat} centerLng={area.lon} label={area.name} />
    </div>
  );
}
