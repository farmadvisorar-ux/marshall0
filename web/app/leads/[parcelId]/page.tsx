import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

interface PageProps {
  params: {
    parcelId: string;
  };
}

export default async function LeadDetailPage({ params }: PageProps) {
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

  // Get lead
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('account_id', account.id)
    .eq('parcel_id', params.parcelId)
    .single();

  if (leadError || !lead) {
    redirect('/leads');
  }

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

      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/leads" className="text-blue-600 dark:text-blue-400 hover:underline mb-6 inline-block">
          ← Back to Leads
        </Link>

        {/* Lead Header */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                {lead.address}
              </h1>
              <p className="text-lg text-slate-600 dark:text-slate-400">
                {lead.city}, {lead.state}
              </p>
            </div>
            <div className="text-right">
              <div className="text-5xl font-bold text-blue-600 dark:text-blue-400">
                {lead.score?.value ? Math.round(lead.score.value) : 0}%
              </div>
              <div className="text-xl text-slate-600 dark:text-slate-400">
                {lead.score?.grade || 'N/A'}
              </div>
            </div>
          </div>

          {lead.hook && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-4 text-blue-900 dark:text-blue-100 italic">
              "{lead.hook}"
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Owner</p>
              <p className="font-semibold text-slate-900 dark:text-white">
                {lead.owner_name || '—'}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Industry</p>
              <p className="font-semibold text-slate-900 dark:text-white capitalize">
                {lead.industry}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Status</p>
              <p className="font-semibold text-slate-900 dark:text-white capitalize">
                {lead.status}
              </p>
            </div>
          </div>
        </div>

        {/* Signals & Score Breakdown */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Signals */}
          {lead.signals && (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                Signals
              </h2>
              <div className="space-y-3">
                {Object.entries(lead.signals).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-slate-700 dark:text-slate-300">
                      {formatSignalName(key)}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatSignalValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contributions to Score */}
          {lead.contributions && (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                Score Contribution
              </h2>
              <div className="space-y-3">
                {Object.entries(lead.contributions).map(([key, value]) => {
                  const total = Object.values(lead.contributions as Record<string, number>).reduce((a, b) => a + Number(b), 0);
                  const percent = total > 0 ? ((Number(value) / total) * 100) : 0;
                  return (
                    <div key={key}>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-700 dark:text-slate-300">
                          {formatSignalName(key)}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {percent.toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Storm & Property Details */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Storm Data */}
          {lead.storm && (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                Storm Activity
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Hail Events (3y)</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {lead.storm.hailEventsLast3y || 0}
                  </p>
                </div>
                {lead.storm.hailMaxInches && (
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Max Hail Size</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">
                      {lead.storm.hailMaxInches}" diameter
                    </p>
                  </div>
                )}
                {lead.storm.lastHailDate && (
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Last Hail Event</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">
                      {formatDate(lead.storm.lastHailDate)}
                    </p>
                  </div>
                )}
                {lead.storm.daysSinceLastHail && (
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Days Since</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">
                      {lead.storm.daysSinceLastHail} days
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Roof & Property Data */}
          {lead.roof && (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                Property Details
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Roof Age</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {lead.roof.ageYears || 0} years old
                  </p>
                </div>
                {lead.roof.material && (
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Material</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white capitalize">
                      {lead.roof.material}
                    </p>
                  </div>
                )}
                {lead.owner && (
                  <>
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Owner Type</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-white capitalize">
                        {lead.owner.segment || 'Unknown'}
                      </p>
                    </div>
                    {lead.owner.occupied !== undefined && (
                      <div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Owner Occupied</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                          {lead.owner.occupied ? 'Yes' : 'No'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
            Actions
          </h2>
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors">
              Mark as Contacted
            </button>
            <button className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors">
              Archive
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function formatSignalName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatSignalValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
