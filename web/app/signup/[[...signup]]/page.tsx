import { SignUp } from '@clerk/nextjs';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4 py-12">
      <SignUp signInUrl="/login" fallbackRedirectUrl="/dashboard" />
    </div>
  );
}
