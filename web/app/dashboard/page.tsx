import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { entitlements, accruedValue, listPrice, billedPrice, plan, isFreeLaunch } from '@engine';

export default async function DashboardPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  // Get account data
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*, profiles(name, email), usage_cycles(accrued_value, leads_released, charged_cycles)')
    .eq('user_id', user.id)
    .single();

  if (accountError || !account) {
    redirect('/login');
  }

  // Get service areas count
  const { data: serviceAreas } = await supabase
    .from('service_areas')
    .select('id', { count: 'exact' })
    .eq('account_id', account.id);

  // Get saved searches count
  const { data: searches } = await supabase
    .from('saved_searches')
    .select('id', { count: 'exact' })
    .eq('account_id', account.id);

  // Get recent leads count (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLeads } = await supabase
    .from('leads')
    .select('id', { count: 'exact' })
    .eq('account_id', account.id)
    .gte('created_at', thirtyDaysAgo);

  const entitlementInfo = entitlements({ plan_id: account.plan_id, free: account.free, founding_member: account.founding_member });
  const planInfo = plan(account.plan_id);
  const monthlyPrice = billedPrice(account.plan_id, { free: account.free, founding_member: account.founding_member });
  const listPriceAmount = listPrice(account.plan_id);

  // Calculate accrued value (mock usage for demo)
  const mockUsage = {
    leadsFound: recentLeads?.length || 0,
    industriesUsed: 1,
    yearsActive: 1 / 12, // less than a month
  };

  const accrued = accruedValue(mockUsage, {
    isFreeAccount: account.free,
    showUnderestimate: false,
    billedAs: account.plan_id,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Prospect Pro
          </h1>
          <nav className="flex items-center gap-4">
            <span className="text-slate-700 dark:text-slate-300">{account.profiles.email}</span>
            <a
              href="/auth/signout"
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Plan & Account Status */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Current Plan */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Current Plan
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Plan</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white capitalize">
                  {account.plan_id}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Monthly Price</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">
                    ${monthlyPrice.toFixed(2)}
                  </p>
                  {account.founding_member && (
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded">
                      Founding Rate (50% off)
                    </span>
                  )}
                  {account.free && (
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded">
                      Free Beta
                    </span>
                  )}
                </div>
              </div>
              {isFreeLaunch() && !account.free && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  List price: ${listPriceAmount}/mo
                </div>
              )}
            </div>
          </div>

          {/* Quota & Usage */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Monthly Quota
            </h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <p className="text-sm text-slate-600 dark:text-slate-400">Leads</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {recentLeads?.length || 0} / {entitlementInfo.leadsPerMonth}
                  </p>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, ((recentLeads?.length || 0) / entitlementInfo.leadsPerMonth) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Industries Included</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {entitlementInfo.industriesIncluded}/{entitlementInfo.industriesTotal}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Service Areas</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {serviceAreas?.length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Accrued Value */}
        {!account.free && accrued && (
          <div className="bg-gradient-to-r from-amber-50 to-amber-50/50 dark:from-amber-900/20 dark:to-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100 mb-2">
              Accrued Value
            </h2>
            <p className="text-3xl font-bold text-amber-900 dark:text-amber-100 mb-2">
              ${accrued.roi?.value.toFixed(2) || '0.00'}
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Value generated by leads found compared to your subscription cost.
            </p>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/search"
            className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
          >
            <div className="text-3xl mb-3">🔍</div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Find Leads
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Run a new search in your service areas
            </p>
          </Link>

          <Link
            href="/leads"
            className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
          >
            <div className="text-3xl mb-3">📋</div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              My Leads
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              View and manage all your leads
            </p>
          </Link>

          <Link
            href="/settings"
            className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all"
          >
            <div className="text-3xl mb-3">⚙️</div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Settings
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Manage your account and service areas
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
