import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Prospect Pro
          </h1>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <div className="text-center mb-16">
          <h2 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-6">
            Find the properties that need your service
          </h2>
          <p className="text-xl text-slate-600 dark:text-slate-400 mb-8 max-w-2xl mx-auto">
            AI-powered lead scoring and discovery. Storm data. Property records. Permit history. Combined and analyzed to find your next customer.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-bold text-lg rounded-lg transition-colors"
          >
            Start Free Today
          </Link>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700">
            <div className="text-4xl mb-4">🌩️</div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Storm Intelligence
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              Real NOAA storm data combined with property records to identify recently damaged properties.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Smart Scoring
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              Industry-specific signals analyzed to score properties from 0-100 based on likelihood to convert.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 border border-slate-200 dark:border-slate-700">
            <div className="text-4xl mb-4">🎯</div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Compliance Built In
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              TCPA, DNC, CAN-SPAM, and FCRA compliance checked automatically. Never cold-call wrongly.
            </p>
          </div>
        </div>

        {/* Pricing Preview */}
        <div className="mb-16">
          <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-8 text-center">
            Simple Pricing
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-8">
              <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Starter
              </h4>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-4">
                $9<span className="text-lg text-slate-600 dark:text-slate-400">/mo</span>
              </p>
              <ul className="space-y-2 text-slate-600 dark:text-slate-400 mb-6">
                <li>✓ 50 leads/month</li>
                <li>✓ 1 industry</li>
                <li>✓ 1 service area</li>
                <li>✓ Basic support</li>
              </ul>
              <button className="w-full px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors">
                Choose
              </button>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-blue-50/50 dark:from-blue-900/30 dark:to-blue-900/10 rounded-lg shadow border-2 border-blue-600 dark:border-blue-400 p-8 relative">
              <div className="absolute top-4 right-4 bg-blue-600 dark:bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                Popular
              </div>
              <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Pro
              </h4>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-4">
                $29<span className="text-lg text-slate-600 dark:text-slate-400">/mo</span>
              </p>
              <ul className="space-y-2 text-slate-600 dark:text-slate-400 mb-6">
                <li>✓ 300 leads/month</li>
                <li>✓ 3 industries</li>
                <li>✓ 2 service areas</li>
                <li>✓ Priority support</li>
              </ul>
              <button className="w-full px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors">
                Choose
              </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 p-8">
              <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Elite
              </h4>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-4">
                $79<span className="text-lg text-slate-600 dark:text-slate-400">/mo</span>
              </p>
              <ul className="space-y-2 text-slate-600 dark:text-slate-400 mb-6">
                <li>✓ 1,000 leads/month</li>
                <li>✓ All industries</li>
                <li>✓ Unlimited areas</li>
                <li>✓ 24/7 support</li>
              </ul>
              <button className="w-full px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors">
                Choose
              </button>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600 rounded-lg p-12 text-center">
          <h3 className="text-3xl font-bold text-white mb-4">
            Ready to find your next lead?
          </h3>
          <p className="text-blue-100 mb-6">
            Join contractors and service businesses finding better leads with Prospect Pro.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 bg-white text-blue-600 dark:text-blue-500 font-bold rounded-lg hover:bg-slate-100 transition-colors"
          >
            Get Started Free
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-4">
                Prospect Pro
              </h4>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                AI-powered lead discovery for service businesses.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-4">
                Product
              </h4>
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li>Features</li>
                <li>Pricing</li>
                <li>Security</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-4">
                Company
              </h4>
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li>Blog</li>
                <li>About</li>
                <li>Contact</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-4">
                Legal
              </h4>
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li>Privacy</li>
                <li>Terms</li>
                <li>Compliance</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-slate-700 pt-8 text-center text-slate-600 dark:text-slate-400 text-sm">
            <p>&copy; 2025 Prospect Pro. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
