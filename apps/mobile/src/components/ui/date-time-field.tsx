/**
 * @module DateTimeField
 *
 * Platform-correct wrapper around `@react-native-community/datetimepicker`.
 *
 * On iOS the native picker is an inline view, which is what every call site
 * here was written for. On Android it is NOT a view — mounting it opens a
 * modal dialog, and while it stays mounted it re-opens on the next render
 * (which every OK/Cancel triggers, because the value or the dismiss changes
 * state). That is the "the calendar keeps popping back up, I can't get out"
 * bug. So on Android this renders a tappable field and mounts the picker
 * only while it is open, unmounting it on the first event — set OR dismiss.
 *
 * Props are a pass-through subset of the native picker's, so call sites only
 * swap the tag. Same test caveat as the other picker files: the native
 * package's Flow-typed source cannot be parsed by `bun:test`, so this file is
 * source-inspected, never render-tested (docs/09-TESTING.md §5 Pattern A).
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/src/components/ui/text';

interface DateTimeFieldProps {
  value: Date;
  mode: 'date' | 'time';
  onChange: (event: unknown, date?: Date) => void;
  is24Hour?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  accentColor?: string;
  textColor?: string;
  themeVariant?: 'light' | 'dark';
  testID?: string;
}

function label(value: Date, mode: 'date' | 'time', is24Hour?: boolean) {
  return mode === 'time'
    ? value.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: is24Hour === true ? false : undefined,
      })
    : value.toLocaleDateString();
}

export function DateTimeField({ testID, ...props }: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);

  if (Platform.OS !== 'android') {
    return <DateTimePicker testID={testID} {...props} />;
  }

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="h-12 items-center justify-center rounded-lg border border-input bg-card px-3"
      >
        <Text>{label(props.value, props.mode, props.is24Hour)}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          {...props}
          onChange={(event: unknown, date?: Date) => {
            setOpen(false);
            props.onChange(event, date);
          }}
        />
      ) : null}
    </View>
  );
}

export type { DateTimeFieldProps };
