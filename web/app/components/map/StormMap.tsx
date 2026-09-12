'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type Storm = {
  id: string;
  type: string;
  date: string;
  magnitude: number | null;
  lat: number;
  lng: number;
  distanceKm: number;
};

type Property = {
  id: string;
  parcelId: string | null;
  address: string | null;
  city: string | null;
  ownerName: string | null;
  ownerOccupied: boolean | null;
  yearBuilt: number | null;
  lat: number;
  lng: number;
  damageScore: number;
  grade: string;
  hailEventsLast3y: number;
  hailMaxInches: number | null;
  lastHailDate: string | null;
};

/**
 * Hail is drawn larger and redder as it gets bigger, because size is the whole
 * story: 2 inches breaks a roof and half an inch does not. Wind is deliberately
 * muted so it reads as context rather than competing with the signal.
 */
function stormStyle(s: Storm): { radius: number; color: string } {
  const isHail = s.type === 'Hail';
  const mag = s.magnitude ?? 0;
  if (!isHail) return { radius: 4, color: '#94a3b8' };
  return {
    radius: Math.min(22, 5 + mag * 6),
    color: mag >= 2 ? '#b91c1c' : mag >= 1.25 ? '#ea580c' : '#f59e0b',
  };
}

const gradeColor = (g: string) =>
  g === 'A' ? '#15803d' : g === 'B' ? '#0369a1' : g === 'C' ? '#a16207' : '#64748b';

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function StormMap({
  centerLat,
  centerLng,
  label,
}: {
  centerLat: number;
  centerLng: number;
  label: string;
}) {
  const [storms, setStorms] = useState<Storm[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [radiusKm, setRadiusKm] = useState(8);
  const [center, setCenter] = useState<[number, number]>([centerLat, centerLng]);
  const initial = useRef<[number, number]>([centerLat, centerLng]);

  const load = useCallback(
    async (lat: number, lng: number, radius: number, signal: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/storms?lat=${lat}&lng=${lng}&radiusKm=${radius}`, { signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load storm data');
        setStorms(json.storms ?? []);
        setProperties(json.properties ?? []);
        setLoading(false);
      } catch (err) {
        // An abort is this component superseding its own request, not a failure
        // the contractor needs to read about.
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load storm data');
        setLoading(false);
      }
    },
    []
  );

  // Dragging the radius slider fires a change per step, so the request waits
  // for the drag to settle. Aborting the previous one also means a slow early
  // response can never overwrite a fast later one.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => load(center[0], center[1], radiusKm, controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [center, radiusKm, load]);

  const moved =
    Math.abs(center[0] - initial.current[0]) > 1e-6 ||
    Math.abs(center[1] - initial.current[1]) > 1e-6;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-sm text-slate-700 dark:text-slate-300">
          <span className="font-semibold">{label}</span>
          {' · '}
          {loading ? (
            'loading…'
          ) : (
            <>
              {storms.length} storm{storms.length === 1 ? '' : 's'} · {properties.length}{' '}
              propert{properties.length === 1 ? 'y' : 'ies'}
            </>
          )}
        </span>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <span className="whitespace-nowrap">Radius {radiusKm} km</span>
          <input
            type="range"
            min={2}
            max={40}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="accent-blue-600"
          />
        </label>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          Click the map to search anywhere
        </span>

        {moved && (
          <button
            type="button"
            onClick={() => setCenter([initial.current[0], initial.current[1]])}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Reset to {label}
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && storms.length === 0 && properties.length === 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-amber-800 dark:text-amber-200 text-sm">
          Nothing within {radiusKm} km of this point. Widen the radius, or click a built-up area.
        </div>
      )}

      <div className="h-[600px] w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={12}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={(lat, lng) => setCenter([lat, lng])} />

          {/* The search area itself, so the counts above have a visible boundary. */}
          <Circle
            center={center}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#2563eb', weight: 1, fill: false, dashArray: '6 6' }}
          />

          {storms.map((s) => {
            const style = stormStyle(s);
            return (
              <CircleMarker
                key={s.id}
                center={[s.lat, s.lng]}
                radius={style.radius}
                pathOptions={{
                  color: style.color,
                  weight: 1,
                  fillColor: style.color,
                  fillOpacity: 0.2,
                }}
              >
                <Popup>
                  <strong>{s.type}</strong>
                  <br />
                  {new Date(s.date).toLocaleDateString('en-US')}
                  {s.magnitude !== null && (
                    <>
                      <br />
                      {s.type === 'Hail' ? `${s.magnitude}" diameter` : `${s.magnitude} kt`}
                    </>
                  )}
                  <br />
                  {s.distanceKm} km from centre
                </Popup>
              </CircleMarker>
            );
          })}

          {properties.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={5}
              pathOptions={{
                color: '#ffffff',
                weight: 1,
                fillColor: gradeColor(p.grade),
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <strong>{p.address ?? 'Address unknown'}</strong>
                {p.city && (
                  <>
                    <br />
                    {p.city}
                  </>
                )}
                {p.ownerName && (
                  <>
                    <br />
                    {p.ownerName}
                  </>
                )}
                <br />
                Score {Math.round(p.damageScore)} ({p.grade})
                {p.yearBuilt ? ` · built ${p.yearBuilt}` : ''}
                <br />
                {p.hailEventsLast3y} hail event{p.hailEventsLast3y === 1 ? '' : 's'} in 3y
                {p.hailMaxInches ? ` · largest ${p.hailMaxInches}"` : ''}
                <br />
                {p.ownerOccupied === null
                  ? 'Occupancy unknown'
                  : p.ownerOccupied
                    ? 'Owner-occupied'
                    : 'Absentee owner'}
                {p.parcelId && (
                  <>
                    <br />
                    <a href={`/leads/${encodeURIComponent(p.parcelId)}`}>Open lead →</a>
                  </>
                )}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
        <Legend color="#b91c1c" label={'Hail 2"+'} />
        <Legend color="#ea580c" label={'Hail 1.25–2"'} />
        <Legend color="#f59e0b" label={'Hail under 1.25"'} />
        <Legend color="#94a3b8" label="Wind" />
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <Legend color="#15803d" label="Grade A" />
        <Legend color="#0369a1" label="Grade B" />
        <Legend color="#a16207" label="Grade C" />
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Storm circles are drawn where NOAA located the report, which is a
        populated place, not the exact hail footprint. Property scores use the
        events measured around each parcel.
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
