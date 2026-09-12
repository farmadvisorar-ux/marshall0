import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export function AppNav() {
  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <Link href="/dashboard" className="text-2xl font-bold text-slate-900 dark:text-white">
          Prospect Pro
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/search"
            className="text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            Find Leads
          </Link>
          <Link
            href="/map"
            className="text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            Storm Map
          </Link>
          <Link
            href="/leads"
            className="text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            My Leads
          </Link>
          <UserButton afterSignOutUrl="/" />
        </nav>
      </div>
    </header>
  );
}
