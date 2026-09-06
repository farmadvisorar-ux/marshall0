'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface SearchCriteria {
  serviceAreaId: string;
  industry: 'roofing' | 'hvac' | 'solar';
  minScore: number;
  filters: Record<string, unknown>;
}

export default function SearchPage() {
  const [criteria, setCriteria] = useState<SearchCriteria>({
    serviceAreaId: '',
    industry: 'roofing',
    minScore: 30,
    filters: {},
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<unknown[]>([]);
  const router = useRouter();
  const supabase = createClient();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResults([]);

    try {
      if (!criteria.serviceAreaId) {
        setError('Please select a service area');
        return;
      }

      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Search failed');
      }

      const data = await response.json();
      setResults(data.leads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSearch = async () => {
    try {
      const response = await fetch('/api/search/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${criteria.industry} search (${new Date().toLocaleDateString()})`,
          industry: criteria.industry,
          serviceAreaId: criteria.serviceAreaId,
          filters: criteria.filters,
        }),
      });

      if (!response.ok) throw new Error('Failed to save search');
      alert('Search saved!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save search');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-2xl font-bold text-slate-900 dark:text-white">
            Prospect Pro
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/leads" className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              My Leads
            </Link>
            <a href="/auth/signout" className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Search Form */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700 sticky top-8">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">
                Search Criteria
              </h2>

              <form onSubmit={handleSearch} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Industry
                  </label>
                  <select
                    value={criteria.industry}
                    onChange={(e) =>
                      setCriteria({ ...criteria, industry: e.target.value as 'roofing' | 'hvac' | 'solar' })
                    }
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="roofing">Roofing</option>
                    <option value="hvac" disabled>HVAC (coming soon)</option>
                    <option value="solar" disabled>Solar (coming soon)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Service Area
                  </label>
                  <select
                    value={criteria.serviceAreaId}
                    onChange={(e) => setCriteria({ ...criteria, serviceAreaId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a service area</option>
                    <option value="demo-tx-48203">Harrison County, TX (Demo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Minimum Score: {criteria.minScore}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={criteria.minScore}
                    onChange={(e) =>
                      setCriteria({ ...criteria, minScore: parseInt(e.target.value) })
                    }
                    className="w-full"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>

                {results.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveSearch}
                    className="w-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Save Search
                  </button>
                )}
              </form>
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-2">
            {results.length === 0 && !loading && (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
                <p className="text-slate-600 dark:text-slate-400 mb-2">
                  Run a search to find leads
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-500">
                  Select your service area and criteria above, then click Search.
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div>
                <div className="mb-4">
                  <p className="text-slate-700 dark:text-slate-300 font-semibold">
                    {results.length} lead{results.length !== 1 ? 's' : ''} found
                  </p>
                </div>

                <div className="space-y-3">
                  {results.map((lead: any, idx) => (
                    <div
                      key={idx}
                      className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="font-semibold text-slate-900 dark:text-white">
                            {lead.address || 'Unknown Address'}
                          </h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {lead.city || ''} {lead.state || ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {Math.round(lead.score?.value || 0)}%
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {lead.score?.grade || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {lead.hook && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 italic mb-3">
                          "{lead.hook}"
                        </p>
                      )}

                      <Link
                        href={`/leads/${lead.parcelId}`}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View Details →
                      </Link>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <button
                    onClick={async () => {
                      try {
                        const csv = generateCSV(results);
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`;
                        a.click();
                      } catch (err) {
                        setError('Failed to export CSV');
                      }
                    }}
                    className="w-full bg-slate-600 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Export as CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function generateCSV(leads: any[]): string {
  const headers = ['Address', 'City', 'State', 'Owner', 'Score', 'Grade', 'Storm', 'Roof Age'];
  const rows = leads.map((lead) => [
    lead.address || '',
    lead.city || '',
    lead.state || '',
    lead.ownerName || '',
    Math.round(lead.score?.value || 0),
    lead.score?.grade || '',
    lead.storm?.lastEventDate || '',
    lead.roof?.ageYears || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((val) => `"${val}"`).join(',')),
  ].join('\n');

  return csvContent;
}
