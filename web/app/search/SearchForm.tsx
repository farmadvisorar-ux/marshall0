'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExportButton } from '../components/ExportButton';

type ServiceArea = { id: string; name: string; county_fips?: string | null };
type County = { fips: string; state: string; name: string };

type Lead = {
  parcelId: string;
  address: string;
  city: string;
  state: string;
  ownerName: string;
  score: { value: number; grade: string; confidence: number };
  signals: { roofAgeYears?: number; yearBuilt?: number | null; propertyValue?: number | null };
  storm: { hailEventsLast3y: number; hailMaxInches: number | null; lastHailDate: string | null };
  hook: string;
};

type Storm = {
  hail_events: number;
  hail_recent: number;
  max_hail_in: number | null;
  last_hail: string | null;
  wind_events: number;
  tornado_events: number;
  fema_declarations: number;
};

type Result = {
  leads: Lead[];
  count: number;
  scanned?: number;
  parcelsAvailable: boolean;
  parcelsInCounty?: number;
  county?: { fips: string; name: string };
  storm?: Storm;
  message?: string;
};

export function SearchForm({ serviceAreas: initial }: { serviceAreas: ServiceArea[] }) {
  const [areas, setAreas] = useState<ServiceArea[]>(initial);
  const [serviceAreaId, setServiceAreaId] = useState(initial[0]?.id ?? '');
  const [minScore, setMinScore] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const [countyQuery, setCountyQuery] = useState('');
  const [matches, setMatches] = useState<County[]>([]);
  const [adding, setAdding] = useState(false);

  const findCounties = async (q: string) => {
    setCountyQuery(q);
    if (q.trim().length < 2) return setMatches([]);
    const res = await fetch(`/api/counties?q=${encodeURIComponent(q)}`);
    if (res.ok) setMatches((await res.json()).counties ?? []);
  };

  const addCounty = async (fips: string) => {
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/service-areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fips }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not add that county');
      setAreas((prev) =>
        prev.some((a) => a.id === data.serviceArea.id) ? prev : [...prev, data.serviceArea]
      );
      setServiceAreaId(data.serviceArea.id);
      setCountyQuery('');
      setMatches([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that county');
    } finally {
      setAdding(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!serviceAreaId) return setError('Add a county first.');

    setLoading(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAreaId, industry: 'roofing', minScore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Service areas</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Any of 3,235 US counties and parishes.
          </p>

          <input
            value={countyQuery}
            onChange={(e) => findCounties(e.target.value)}
            placeholder="Search: Harrison, Orleans Parish, TX…"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {matches.length > 0 && (
            <ul className="mt-2 max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
              {matches.map((c) => (
                <li key={c.fips}>
                  <button
                    type="button"
                    disabled={adding}
                    onClick={() => addCounty(c.fips)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-900 dark:text-white hover:bg-blue-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {c.name}, {c.state}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {areas.length > 0 && (
            <ul className="mt-4 space-y-1">
              {areas.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="area"
                    checked={serviceAreaId === a.id}
                    onChange={() => setServiceAreaId(a.id)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-slate-800 dark:text-slate-200">{a.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          onSubmit={handleSearch}
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700 space-y-4"
        >
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Minimum score: {minScore}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <button
            type="submit"
            disabled={loading || !serviceAreaId}
            className="w-full bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 space-y-6">
        {result?.storm && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Storm record — {result.county?.name}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Hail (3y)" value={result.storm.hail_recent} />
              <Stat label="Hail (all)" value={result.storm.hail_events} />
              <Stat
                label="Largest hail"
                value={result.storm.max_hail_in ? `${result.storm.max_hail_in}"` : '—'}
              />
              <Stat label="Wind events" value={result.storm.wind_events} />
              <Stat label="Tornadoes" value={result.storm.tornado_events} />
              <Stat label="FEMA declarations" value={result.storm.fema_declarations} />
              <Stat
                label="Last hail"
                value={result.storm.last_hail ? String(result.storm.last_hail).slice(0, 10) : '—'}
              />
              {result.parcelsInCounty != null && (
                <Stat label="Parcels on file" value={result.parcelsInCounty.toLocaleString()} />
              )}
            </div>
          </div>
        )}

        {result && !result.parcelsAvailable && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6">
            <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
              No parcel source connected for this county yet
            </h3>
            <p className="text-sm text-amber-800 dark:text-amber-200">{result.message}</p>
          </div>
        )}

        {!result && !loading && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400 mb-2">Pick a county and search</p>
            <p className="text-sm text-slate-500 dark:text-slate-500">
              Scored against 319,576 NOAA storm events, 2015 to today.
            </p>
          </div>
        )}

        {result && result.leads.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-slate-700 dark:text-slate-300 font-semibold">
                {result.count} lead{result.count === 1 ? '' : 's'}
                {result.scanned ? ` from ${result.scanned.toLocaleString()} parcels scanned` : ''}
              </p>
              <ExportButton
                rows={result.leads.map((l) => ({
                  address: l.address,
                  city: l.city,
                  state: l.state,
                  owner: l.ownerName,
                  score: Math.round(l.score.value),
                  grade: l.score.grade,
                  built: l.signals.yearBuilt ?? '',
                  hail3y: l.storm.hailEventsLast3y,
                  hook: l.hook,
                }))}
                columns={[
                  { header: 'Address', key: 'address' },
                  { header: 'City', key: 'city' },
                  { header: 'State', key: 'state' },
                  { header: 'Owner', key: 'owner' },
                  { header: 'Score', key: 'score' },
                  { header: 'Grade', key: 'grade' },
                  { header: 'Year built', key: 'built' },
                  { header: 'Hail 3y', key: 'hail3y' },
                  { header: 'Opening line', key: 'hook' },
                ]}
                filename={`prospect-pro-${new Date().toISOString().slice(0, 10)}.csv`}
                className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
              />
            </div>

            <div className="space-y-3">
              {result.leads.map((lead) => (
                <div
                  key={lead.parcelId}
                  className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex justify-between items-start gap-4 mb-1">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{lead.address}</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {lead.city}, {lead.state} · {lead.ownerName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {Math.round(lead.score.value)}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {lead.score.grade} · {Math.round(lead.score.confidence * 100)}% conf
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Built {lead.signals.yearBuilt ?? '—'} · {lead.storm.hailEventsLast3y} hail events
                    within 3km in 3 years
                    {lead.storm.hailMaxInches ? ` · largest ${lead.storm.hailMaxInches}"` : ''}
                  </p>
                  {lead.hook && (
                    <p className="text-sm text-slate-700 dark:text-slate-300 italic">{lead.hook}</p>
                  )}
                  <Link
                    href={`/leads/${encodeURIComponent(lead.parcelId)}`}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block"
                  >
                    View details →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && result.parcelsAvailable && result.leads.length === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400">
              {result.scanned?.toLocaleString()} parcels scanned, none scored above {minScore}. Lower
              the minimum score.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
      <p className="text-xl font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
