import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { searchCounties } from '@/lib/db';

export async function GET(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ counties: [] });

  return NextResponse.json({ counties: await searchCounties(q) });
}
