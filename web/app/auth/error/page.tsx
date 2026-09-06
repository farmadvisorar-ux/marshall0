import Link from 'next/link';

interface PageProps {
  searchParams?: {
    message?: string;
  };
}

export default function AuthErrorPage({ searchParams }: PageProps) {
  const message = searchParams?.message || 'An authentication error occurred.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8">
          <div className="text-5xl mb-4 text-center">⚠️</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-4">
            Authentication Error
          </h1>

          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm mb-6">
            {message}
          </div>

          <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
            Please try again or contact support if the problem persists.
          </p>

          <div className="space-y-3">
            <Link
              href="/login"
              className="block w-full text-center bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Back to Sign In
            </Link>
            <Link
              href="/"
              className="block w-full text-center bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
