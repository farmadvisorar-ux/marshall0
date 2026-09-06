import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const { sessionId } = await auth();

  if (!sessionId) {
    return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL));
  }

  // Clerk's sign out is handled by Clerk middleware
  // Redirect to Clerk's sign out endpoint
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL}?redirect_url=/`,
    { status: 303 }
  );
}
