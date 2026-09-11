import Link from 'next/link';
import { AppNav } from '../components/AppNav';
import { requireAccount } from '@/lib/session';
import { listServiceAreas, countLeadsSince, currentCycleStart } from '@/lib/db';
import {
  entitlements,
  accruedValue,
  listPrice,
  billedPrice,
  isFreeLaunch,
  usd,
  type PlanId,
} from '@engine';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const account = await requireAccount();
  const planId = account.plan_id as PlanId;

  const used = await countLeadsSince(account.id, currentCycleStart());
  const serviceAreas = await listServiceAreas(account.id);

  const ent = entitlements({
    planId,
    industries: ['roofing'],
    used,
    free: account.free,
    foundingMember: account.founding_member,
  });

  const monthlyPrice = billedPrice(planId, {
    free: account.free,
    foundingMember: account.founding_member,
  });

  const accrued = accruedValue({ leadsPerMonth: used, industries: 1 }, { cyclesActive: 1 });

  const quotaPercent = ent.quota.percentUsed ?? 0;
  const quotaLabel =
    ent.quota.included === null ? 'Unlimited' : ent.quota.included.toLocaleString('en-US');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AppNav />

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Current plan</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Plan</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white capitalize">{planId}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Billed today</p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{usd(monthlyPrice)}</p>
                  {account.free && (
                    <span className="text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded">
                      Free beta
                    </span>
                  )}
                  {account.founding_member && (
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded">
                      Founding member
                    </span>
                  )}
                </div>
              </div>
              {isFreeLaunch() && account.free && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  List price is {usd(listPrice(planId))}/mo. You are not being billed.
                </p>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">This month</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <p className="text-sm text-slate-600 dark:text-slate-400">Leads</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {ent.quota.used.toLocaleString('en-US')} / {quotaLabel}
                  </p>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                    style={{ width: `${Math.min(100, quotaPercent)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Remaining</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {ent.quota.remaining === null
                      ? 'Unlimited'
                      : ent.quota.remaining.toLocaleString('en-US')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Service areas</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {serviceAreas.length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {used > 0 && (
          <div className="bg-gradient-to-r from-amber-50 to-amber-50/50 dark:from-amber-900/20 dark:to-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100 mb-2">
              What this is worth
            </h2>
            <p className="text-amber-900 dark:text-amber-100 mb-1">{accrued.headline}</p>
            <p className="text-sm text-amber-800 dark:text-amber-200">{accrued.detail}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Link
            href="/search"
            className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Find leads</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Run a new search across your service areas
            </p>
          </Link>

          <Link
            href="/leads"
            className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">My leads</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Review and work the leads you have already found
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
