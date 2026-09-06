import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
      <div className="w-full max-w-md">
        <SignIn
          routing="path"
          path="/login"
          signUpUrl="/signup"
          afterSignInUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'bg-white dark:bg-slate-800 shadow-lg rounded-lg border border-slate-200 dark:border-slate-700',
              headerTitle: 'text-slate-900 dark:text-white',
              headerSubtitle: 'text-slate-600 dark:text-slate-400',
              formFieldInput: 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white',
              footerActionText: 'text-slate-600 dark:text-slate-400',
              footerActionLink: 'text-blue-600 dark:text-blue-400 hover:underline',
              dividerText: 'text-slate-600 dark:text-slate-400',
              dividerLine: 'bg-slate-200 dark:bg-slate-700',
              socialButtonsBlockButton: 'border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white',
              buttonPrimary: 'bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white',
            },
          }}
        />
      </div>
    </div>
  );
}
