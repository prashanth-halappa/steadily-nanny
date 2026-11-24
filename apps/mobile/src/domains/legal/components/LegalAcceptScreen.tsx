/**
 * @module domains/legal/components/LegalAcceptScreen
 * Full-screen clickwrap gate for accepting the current Terms of Service and
 * Privacy Policy. Signing out on decline is delegated to the auth store;
 * gating/redirection lives in the navigation layouts (not here).
 */
import { type Href, useRouter } from 'expo-router';
import { ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, Display, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { useAcceptLegal } from '@/src/hooks/mutations/useAcceptLegal';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;

export function LegalAcceptScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const signOut = useAuthStore(s => s.signOut);
  const { mutate, isPending, isError } = useAcceptLegal();

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="legal-accept-screen"
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
          paddingTop: SCREEN_CONTENT_STYLE.padding,
          paddingBottom: SCREEN_CONTENT_STYLE.padding,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-between gap-6">
          <View className="gap-4">
            <Display>{t('auth:legalGate.title')}</Display>

            <View className="rounded-xl bg-muted p-4">
              <Body className="text-foreground">
                {t('auth:legalGate.beta')}
              </Body>
            </View>

            <Body className="text-muted-foreground">
              {t('auth:legalGate.body')}
            </Body>

            <View className="gap-2">
              <Pressable
                testID="legal-terms-link"
                accessibilityRole="link"
                onPress={() => void openExternalUrl(TERMS_URL, 'legal-terms')}
                className="min-h-12 flex-row items-center justify-between rounded-xl border border-border bg-card px-4 py-3 active:bg-accent"
              >
                <Body weight="semibold" className="text-primary">
                  {t('auth:legalGate.termsLink')}
                </Body>
                <ExternalLink size={18} color={colors.primary} />
              </Pressable>

              <Pressable
                testID="legal-privacy-link"
                accessibilityRole="link"
                onPress={() =>
                  void openExternalUrl(PRIVACY_URL, 'legal-privacy')
                }
                className="min-h-12 flex-row items-center justify-between rounded-xl border border-border bg-card px-4 py-3 active:bg-accent"
              >
                <Body weight="semibold" className="text-primary">
                  {t('auth:legalGate.privacyLink')}
                </Body>
                <ExternalLink size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>

          <View className="shrink-0 gap-3">
            {isError ? (
              <InlineError
                testID="legal-error"
                message={t('auth:legalGate.error')}
              />
            ) : null}

            <Small className="text-muted-foreground">
              {t('auth:legalGate.consent')}
            </Small>

            <LoadingButton
              testID="legal-agree"
              label={t('auth:legalGate.agree')}
              isLoading={isPending}
              disabled={isPending}
              onPress={() =>
                mutate(undefined, {
                  onSuccess: () => router.replace('/' as Href),
                })
              }
            />

            <Button
              testID="legal-decline"
              variant="ghost"
              disabled={isPending}
              onPress={() => void signOut()}
            >
              <Text>{t('auth:legalGate.decline')}</Text>
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
