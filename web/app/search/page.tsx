import { AppNav } from '../components/AppNav';
import { SearchForm } from './SearchForm';
import { requireAccount } from '@/lib/session';
import { listServiceAreas } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const account = await requireAccount();
  const serviceAreas = await listServiceAreas(account.id);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <SearchForm serviceAreas={serviceAreas} />
      </main>
    </div>
  );
}
