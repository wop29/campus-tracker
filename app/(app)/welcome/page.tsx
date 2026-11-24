import { OnboardingWizard } from '@/components/onboarding/wizard';

export const metadata = { title: 'Welcome' };

export default function WelcomePage() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl items-center px-4 py-8 sm:py-12">
      <OnboardingWizard />
    </div>
  );
}
