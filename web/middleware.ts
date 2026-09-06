import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/signup(.*)',
  '/api/webhooks(.*)',
]);

export default clerkMiddleware((auth, request) => {
  // Protect non-public routes
  if (!isPublicRoute(request)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|cur|heic|webm|mp4)(?:$|[?#])|_next).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
