import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AppNav } from '../../components/AppNav';
import { LeadStatusActions } from '../../components/LeadStatusActions';
import { requireAccount } from '@/lib/session';
import { getLead } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({ params }: { params: { parcelId: string } }) {
  const account = await requireAccount();
  const lead = await getLead(account.id, decodeURIComponent(params.parcelId));

  if (!lead) notFound();

  const contributions = lead.contributions ?? {};
  const contributionTotal = Object.values(contributions).reduce((a, b) => a + Number(b), 0);
  const storm = (lead.storm ?? {}) as Record<string, any>;
  const roof = (lead.roof ?? {}) as Record<string, any>;
  const owner = (lead.owner ?? {}) as Record<string, any>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AppNav />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/leads" className="text-blue-600 dark:text-blue-400 hover:underline mb-6 inline-block">
          ← Back to leads
        </Link>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700 mb-8">
          <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{lead.address}</h1>
              <p className="text-lg text-slate-600 dark:text-slate-400">
                {lead.city}, {lead.state}
              </p>
            </div>
            <div className="text-right">
              <div className="text-5xl font-bold text-blue-600 dark:text-blue-400">
                {lead.score?.value != null ? Math.round(lead.score.value) : 0}
              </div>
              <div className="text-xl text-slate-600 dark:text-slate-400">
                {lead.score?.grade ?? ''}
              </div>
            </div>
          </div>

          {lead.hook && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-4 text-blue-900 dark:text-blue-100 italic">
              {lead.hook}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
            <Field label="Owner" value={lead.owner_name || '—'} />
            <Field label="Industry" value={lead.industry} />
            <Field label="Status" value={lead.status} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {lead.signals && Object.keys(lead.signals).length > 0 && (
            <Card title="Signals">
              <div className="space-y-3">
                {Object.entries(lead.signals).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <span className="text-slate-700 dark:text-slate-300">{humanize(key)}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {contributionTotal > 0 && (
            <Card title="What drove the score">
              <div className="space-y-3">
                {Object.entries(contributions).map(([key, value]) => {
                  const percent = (Number(value) / contributionTotal) * 100;
                  return (
                    <div key={key}>
                      <div className="flex justify-between mb-1 gap-4">
                        <span className="text-slate-700 dark:text-slate-300">{humanize(key)}</span>
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
            </Card>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700 mb-8">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Pipeline</h2>
          <LeadStatusActions parcelId={lead.parcel_id} current={lead.status} />
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {Object.keys(storm).length > 0 && (
            <Card title="Storm activity">
              <div className="space-y-3">
                <Field label="Hail events (3y)" value={String(storm.hailEventsLast3y ?? 0)} />
                {storm.hailMaxInches != null && (
                  <Field label="Largest hail" value={`${storm.hailMaxInches}" diameter`} />
                )}
                {storm.lastHailDate && (
                  <Field label="Last hail event" value={formatDate(String(storm.lastHailDate))} />
                )}
                {storm.hailEventsCountyWide != null && (
                  <Field
                    label="County-wide reports"
                    value={`${storm.hailEventsCountyWide} (not located to this parcel)`}
                  />
                )}
              </div>
            </Card>
          )}

          {(Object.keys(roof).length > 0 || Object.keys(owner).length > 0) && (
            <Card title="Property">
              <div className="space-y-3">
                {roof.ageYears != null && <Field label="Roof age" value={`${roof.ageYears} years`} />}
                {roof.material && <Field label="Material" value={String(roof.material)} />}
                {owner.segment && <Field label="Owner type" value={String(owner.segment)} />}
                {owner.occupied !== undefined && (
                  <Field label="Owner occupied" value={owner.occupied ? 'Yes' : 'No'} />
                )}
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{label}</p>
      <p className="font-semibold text-slate-900 dark:text-white capitalize">{value}</p>
    </div>
  );
}

function humanize(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
