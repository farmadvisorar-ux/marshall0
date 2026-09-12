import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/db';

// A health check that can be served from cache is not a health check.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/health
 *
 * Public on purpose: a check behind authentication cannot be read by an
 * uptime monitor, which is the only thing that reads it. It exposes no
 * customer data — connectivity, approximate table sizes, and which build is
 * serving, so a bad deploy can be identified without opening a dashboard.
 *
 * 503 rather than 200-with-a-flag when the database is unreachable, because
 * every monitor and load balancer understands a status code and none of them
 * parse a body.
 */
export async function GET() {
  const database = await healthCheck();

  return NextResponse.json(
    {
      status: database.ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      checks: { database },
      deployment: {
        env: process.env.VERCEL_ENV ?? 'development',
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
    },
    {
      status: database.ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
