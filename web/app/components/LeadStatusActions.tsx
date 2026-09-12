'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACTIONS: { status: string; label: string; tone: string }[] = [
  { status: 'contacted', label: 'Mark contacted', tone: 'bg-blue-600 hover:bg-blue-700 text-white' },
  { status: 'won', label: 'Won', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  { status: 'lost', label: 'Lost', tone: 'bg-slate-500 hover:bg-slate-600 text-white' },
  {
    status: 'discarded',
    label: 'Discard',
    tone: 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white',
  },
];

export function LeadStatusActions({
  parcelId,
  current,
}: {
  parcelId: string;
  current: string;
}) {
  const [status, setStatus] = useState(current);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  const set = async (next: string) => {
    setPending(next);
    setError('');
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(parcelId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not update');
      setStatus(data.lead.status);
      // The list and dashboard counts read from the server, so they need to
      // re-fetch rather than drift from what this page now shows.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {ACTIONS.map((a) => (
          <button
            key={a.status}
            type="button"
            disabled={pending !== null || status === a.status}
            onClick={() => set(a.status)}
            className={`px-4 py-2 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${a.tone}`}
          >
            {pending === a.status ? 'Saving…' : a.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
        Current status: <span className="font-semibold capitalize">{status}</span>
      </p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
