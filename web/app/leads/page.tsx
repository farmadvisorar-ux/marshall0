import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function LeadsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  // Get account
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (accountError || !account) {
    redirect('/login');
  }

  // Get leads
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('*')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false });

  if (leadsError) {
    console.error('Error fetching leads:', leadsError);
  }

  const leadsData = leads || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-2xl font-bold text-slate-900 dark:text-white">
            Prospect Pro
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/search" className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              Find Leads
            </Link>
            <a href="/auth/signout" className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
            My Leads
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {leadsData.length} lead{leadsData.length !== 1 ? 's' : ''} found
          </p>
        </div>

        {leadsData.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              You haven't found any leads yet.
            </p>
            <Link
              href="/search"
              className="inline-block bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Start a Search
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Owner
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Score
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Industry
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-900 dark:text-white uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {leadsData.map((lead: any) => (
                  <tr
                    key={lead.id}
                    className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {lead.address}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {lead.city}, {lead.state}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-900 dark:text-white">
                      {lead.owner_name || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          {lead.score?.value ? Math.round(lead.score.value) : 0}%
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {lead.score?.grade || 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-900 dark:text-white capitalize">
                      {lead.industry}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                        lead.status === 'available'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : lead.status === 'contacted'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : lead.status === 'discarded'
                          ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                      }`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/leads/${lead.parcel_id}`}
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

        {leadsData.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => {
                const csv = generateLeadsCSV(leadsData);
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `prospect-pro-leads-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
              }}
              className="bg-slate-600 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Export All Leads
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function generateLeadsCSV(leads: any[]): string {
  const headers = [
    'Address',
    'City',
    'State',
    'Owner',
    'Score',
    'Grade',
    'Industry',
    'Status',
    'Created',
  ];

  const rows = leads.map((lead) => [
    lead.address || '',
    lead.city || '',
    lead.state || '',
    lead.owner_name || '',
    lead.score?.value ? Math.round(lead.score.value) : '',
    lead.score?.grade || '',
    lead.industry || '',
    lead.status || '',
    lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((val) => `"${String(val)}"`).join(',')),
  ].join('\n');

  return csvContent;
}
