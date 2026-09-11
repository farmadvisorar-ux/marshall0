import Link from 'next/link';
import { AppNav } from '../components/AppNav';
import { ExportButton } from '../components/ExportButton';
import { requireAccount } from '@/lib/session';
import { listLeads } from '@/lib/db';

export const dynamic = 'force-dynamic';

const statusStyles: Record<string, string> = {
  available: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  contacted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  won: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  lost: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  discarded: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
};

export default async function LeadsPage() {
  const account = await requireAccount();
  const leads = await listLeads(account.id);

  const exportRows = leads.map((lead) => ({
    address: lead.address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    owner: lead.owner_name ?? '',
    score: lead.score?.value != null ? Math.round(lead.score.value) : '',
    grade: lead.score?.grade ?? '',
    industry: lead.industry,
    status: lead.status,
    found: new Date(lead.created_at).toLocaleDateString('en-US'),
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AppNav />

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">My leads</h1>
            <p className="text-slate-600 dark:text-slate-400">
              {leads.length} lead{leads.length === 1 ? '' : 's'}
            </p>
          </div>
          {leads.length > 0 && (
            <ExportButton
              rows={exportRows}
              columns={[
                { header: 'Address', key: 'address' },
                { header: 'City', key: 'city' },
                { header: 'State', key: 'state' },
                { header: 'Owner', key: 'owner' },
                { header: 'Score', key: 'score' },
                { header: 'Grade', key: 'grade' },
                { header: 'Industry', key: 'industry' },
                { header: 'Status', key: 'status' },
                { header: 'Found', key: 'found' },
              ]}
              filename={`prospect-pro-leads-${new Date().toISOString().slice(0, 10)}.csv`}
              className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold py-2 px-5 rounded-lg transition-colors"
            />
          )}
        </div>

        {leads.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              You have not found any leads yet.
            </p>
            <Link
              href="/search"
              className="inline-block bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Start a search
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                  {['Address', 'Owner', 'Score', 'Industry', 'Status', ''].map((header) => (
                    <th
                      key={header}
                      className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-slate-200 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{lead.address}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {lead.city}, {lead.state}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-900 dark:text-white">
                      {lead.owner_name || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          {lead.score?.value != null ? Math.round(lead.score.value) : 0}
                        </span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {lead.score?.grade ?? ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-900 dark:text-white capitalize">
                      {lead.industry}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          statusStyles[lead.status] ?? statusStyles.discarded
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/leads/${encodeURIComponent(lead.parcel_id)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
