import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';

interface Props {
  visible: boolean;
  onResume: () => void;
  onStartOver: () => void;
}

/** "Resume onboarding?" prompt for a returning, mid-flow user. */
export function ResumeModal({ visible, onResume, onStartOver }: Props) {
  return (
    <BottomSheetBase sheetId="onboarding-resume" visible={visible} fitContent>
      <View className="gap-3 px-6 pb-4">
        <H3>Welcome back</H3>
        <Body className="text-muted-foreground">
          You have onboarding left to finish. Pick up where you left off?
        </Body>
        <Button onPress={onResume}>
          <Text>Resume</Text>
        </Button>
        <Button variant="ghost" onPress={onStartOver}>
          <Text>Start over</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
