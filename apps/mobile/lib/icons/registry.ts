/**
 * Lucide Icon Registry — cssInterop registration for NativeWind className support.
 *
 * Import this file early in the app (root _layout.tsx) so the Lucide icons used
 * across the UI support NativeWind className props (e.g. className="text-foreground").
 *
 * Without this registration, className on a raw Lucide SVG icon is silently
 * ignored, so icons render with their default color regardless of theme.
 *
 * Register additional icons here as your app adopts them.
 */
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Sparkles,
  X,
} from 'lucide-react-native';
import { iconWithClassName } from './iconWithClassName';

// Register icons for NativeWind className support.
// cssInterop mutates the component reference globally — since JS modules are
// singletons, any file that imports these icons gets the registered version.
const icons = [Check, ChevronDown, ChevronRight, ChevronUp, Sparkles, X];

for (const icon of icons) {
  iconWithClassName(icon);
}
