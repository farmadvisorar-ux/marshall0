import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/signup(.*)',
  '/api/webhooks(.*)',
]);

// signInUrl is set explicitly rather than read from NEXT_PUBLIC_CLERK_SIGN_IN_URL:
// without it Clerk redirects signed-out visitors to its default /sign-in, which
// this app does not serve, and a protected page 404s instead of asking them to
// log in. API routes still get a 404 from protect(), which is what we want —
// an unauthenticated POST should not be told the route exists.
export default clerkMiddleware(
  (auth, request) => {
    if (!isPublicRoute(request)) {
      auth().protect();
    }
  },
  { signInUrl: '/login' }
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|cur|heic|webm|mp4)(?:$|[?#])|_next).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
