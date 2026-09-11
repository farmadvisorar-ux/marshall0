import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { provisionAccount, type Account } from './db';

/**
 * Resolves the signed-in Clerk user to a Prospect Pro account, provisioning
 * one if the webhook has not delivered yet. Redirects to /login when there is
 * no session at all.
 */
export async function requireAccount(): Promise<Account> {
  const { userId } = auth();
  if (!userId) redirect('/login');

  const user = await currentUser();
  if (!user) redirect('/login');

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) redirect('/login');

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  return provisionAccount(userId, email, name);
}
