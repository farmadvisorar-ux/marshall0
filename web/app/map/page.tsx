import Link from 'next/link';
import { AppNav } from '../components/AppNav';
import { MapPanel } from './MapPanel';
import { requireAccount } from '@/lib/session';
import { listServiceAreas, mappableAreas } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const account = await requireAccount();
  const [areas, allAreas] = await Promise.all([
    mappableAreas(account.id),
    listServiceAreas(account.id),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AppNav />

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">Storm map</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Hail and wind reports over the properties underneath them. Click anywhere to
            re-centre the search.
          </p>
        </div>

        {areas.length > 0 ? (
          <MapPanel areas={areas} />
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700 text-center">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
              Nothing to map yet
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              {allAreas.length === 0
                ? 'Add a service area and load its property records, and the map will open on it.'
                : 'Your service areas have no property records loaded yet. Load one and it will appear here.'}
            </p>
            <Link
              href="/search"
              className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Go to Find Leads
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
