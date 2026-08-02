import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { Small } from '@/src/components/ui/typography';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

/** Dismissible banner when a non-required update is available. */
export function SoftUpdateBanner() {
  const { t } = useTranslation('settings');
  const status = useAppConfigStore(s => s.status);
  const [dismissed, setDismissed] = useState(false);
  const update = status?.update;

  if (!update?.available || update.required || dismissed) return null;

  return (
    <View
      testID="soft-update-banner"
      className="flex-row items-center justify-between bg-muted px-4 py-2"
    >
      <Small className="text-muted-foreground">
        {t('softUpdateBanner.message')}
      </Small>
      <View className="flex-row gap-4">
        <AnimatedPressable
          onPress={() => void openExternalUrl(update.storeUrl)}
        >
          <Small className="text-primary">{t('softUpdateBanner.update')}</Small>
        </AnimatedPressable>
        <AnimatedPressable onPress={() => setDismissed(true)}>
          <Small className="text-muted-foreground">
            {t('softUpdateBanner.dismiss')}
          </Small>
        </AnimatedPressable>
      </View>
    </View>
  );
}
