import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { OnboardingScreenShell } from '@/src/domains/onboarding';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useOnboardingNavigation } from '@/src/hooks/navigation/useOnboardingNavigation';

export default function OnboardingProfile() {
  const [name, setName] = useState('');
  const { completeAndAdvance } = useOnboardingNavigation();
  const upsert = useUpsertProfile();

  const onSubmit = () => {
    // SETUP: this template collects only a display name. city/country are
    // required by the shared UserProfileRequest — collect real values if your
    // app needs them, or relax the schema in src/api/endpoints/user.ts.
    upsert.mutate(
      { name: name.trim(), city: 'N/A', country: 'N/A' },
      { onSuccess: () => completeAndAdvance('PROFILE') }
    );
  };

  return (
    <OnboardingScreenShell
      progress={0.33}
      title="What should we call you?"
      ctaLabel="Continue"
      onCta={onSubmit}
      ctaDisabled={!name.trim() || upsert.isPending}
    >
      <View className="gap-2">
        <Label>Display name</Label>
        <Input
          accessibilityLabel="Display name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoFocus
        />
      </View>
    </OnboardingScreenShell>
  );
}
