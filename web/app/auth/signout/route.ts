import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(
    new URL('/', request.url),
    { status: 302 }
  );
}

export async function GET(request: NextRequest) {
  // Allow signout via GET as well (for link clicks)
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(
    new URL('/', request.url),
    { status: 302 }
  );
}
