'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExportButton } from '../components/ExportButton';

type ServiceArea = { id: string; name: string };

type Lead = {
  parcelId: string;
  address: string;
  city: string;
  state: string;
  ownerName: string;
  score: { value: number; grade: string };
  hook: string;
};

export function SearchForm({ serviceAreas }: { serviceAreas: ServiceArea[] }) {
  const [serviceAreaId, setServiceAreaId] = useState(serviceAreas[0]?.id ?? '');
  const [industry, setIndustry] = useState('roofing');
  const [minScore, setMinScore] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Lead[] | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResults(null);

    if (!serviceAreaId) {
      setError('Pick a service area first.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAreaId, industry, minScore }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Search failed');
      setResults(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <form
          onSubmit={handleSearch}
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700 space-y-4 lg:sticky lg:top-8"
        >
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Search criteria</h2>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Industry
            </span>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="roofing">Roofing</option>
              <option value="hvac" disabled>
                HVAC (coming soon)
              </option>
              <option value="solar" disabled>
                Solar (coming soon)
              </option>
            </select>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Service area
            </span>
            <select
              value={serviceAreaId}
              onChange={(e) => setServiceAreaId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {serviceAreas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>

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
            disabled={loading}
            className="w-full bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-2">
        {results === null && !loading && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400 mb-2">Run a search to find leads</p>
            <p className="text-sm text-slate-500 dark:text-slate-500">
              Pick a service area and a minimum score, then search.
            </p>
          </div>
        )}

        {results !== null && results.length === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400">
              No properties scored above {minScore} in this area. Try lowering the minimum score.
            </p>
          </div>
        )}

        {results !== null && results.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-slate-700 dark:text-slate-300 font-semibold">
                {results.length} lead{results.length === 1 ? '' : 's'} found
              </p>
              <ExportButton
                rows={results.map((lead) => ({
                  address: lead.address,
                  city: lead.city,
                  state: lead.state,
                  owner: lead.ownerName,
                  score: Math.round(lead.score?.value ?? 0),
                  grade: lead.score?.grade ?? '',
                  hook: lead.hook,
                }))}
                columns={[
                  { header: 'Address', key: 'address' },
                  { header: 'City', key: 'city' },
                  { header: 'State', key: 'state' },
                  { header: 'Owner', key: 'owner' },
                  { header: 'Score', key: 'score' },
                  { header: 'Grade', key: 'grade' },
                  { header: 'Opening line', key: 'hook' },
                ]}
                filename={`prospect-pro-search-${new Date().toISOString().slice(0, 10)}.csv`}
                className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
              />
            </div>

            <div className="space-y-3">
              {results.map((lead) => (
                <div
                  key={lead.parcelId}
                  className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{lead.address}</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {lead.city}, {lead.state}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {Math.round(lead.score?.value ?? 0)}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {lead.score?.grade ?? ''}
                      </p>
                    </div>
                  </div>

                  {lead.hook && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 italic mb-3">{lead.hook}</p>
                  )}

                  <Link
                    href={`/leads/${encodeURIComponent(lead.parcelId)}`}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    View details →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
