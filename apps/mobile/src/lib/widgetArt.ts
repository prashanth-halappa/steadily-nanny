/**
 * @module lib/widgetArt
 *
 * The "lit window" illustrations (redesign spec §8) ship inside the app
 * bundle, but the widget and Live Activity extensions are separate processes
 * that cannot read it. `Image uiImage` takes a file URI, so each PNG has to be
 * copied once into the App Group container — see `widgetsDirectorySafe`. No
 * native rebuild is involved: the copy is ordinary runtime file IO.
 *
 * Everything here is best-effort and never throws. Illustrations carry zero
 * information, so a failed copy just leaves `widgetArtUri` returning null,
 * which is the documented fallback every layout already handles (see
 * `WidgetSnapshotBase.artLightUri`).
 *
 * **The `require`s are deliberately inside `ensureWidgetArt`, not at module
 * scope.** `widgetSnapshot` and `liveActivity` import `widgetArtUri`, and both
 * are heavily unit-tested; a top-level `require` of a `.png` breaks bundling
 * under `bun:test` (the same trap `loading-indicator`'s splash image sets —
 * see `HoursScreen.test.tsx`'s header). Kept lazy, tests never evaluate them
 * and need no mock.
 */
import { reportWidgetFailure, widgetsDirectorySafe } from './expoWidgets';

/** Basenames of the six exported PNGs, minus the extension. */
export type WidgetArtName =
  | 'la-running-dark'
  | 'la-receipt-dark'
  | 'empty-light'
  | 'empty-dark'
  | 'startingsoon-light'
  | 'startingsoon-dark';

const uris = new Map<WidgetArtName, string>();

let attempted = false;

/** Test-only: forget the copied URIs and allow another copy attempt. */
export function resetWidgetArtForTests(): void {
  uris.clear();
  attempted = false;
}

/**
 * The App Group URI for one illustration, or null until `ensureWidgetArt` has
 * copied it (and forever, if the copy failed). Callers pass it straight into a
 * payload's `artLightUri` / `artDarkUri` / `artUri`.
 */
export function widgetArtUri(name: WidgetArtName): string | null {
  return uris.get(name) ?? null;
}

/**
 * Copy every illustration into the App Group, once per launch. Safe to call
 * concurrently and safe to call when widgets are unavailable.
 *
 * The destination filename carries the asset's content hash, so shipping new
 * art lands under a new name instead of being masked by the old copy that an
 * `exists` check would otherwise consider done. Superseded copies are left
 * behind; they are a few KB each and the container is ours.
 */
export async function ensureWidgetArt(): Promise<void> {
  if (attempted) return;
  attempted = true;

  const directory = widgetsDirectorySafe();
  if (!directory) return;

  // Required lazily, and inside the function, for the bun:test reason in the
  // module header. Metro still sees static paths, so these stay bundled.
  const sources: Record<WidgetArtName, number> = {
    'la-running-dark': require('../../assets/widget-art/la-running-dark.png'),
    'la-receipt-dark': require('../../assets/widget-art/la-receipt-dark.png'),
    'empty-light': require('../../assets/widget-art/empty-light.png'),
    'empty-dark': require('../../assets/widget-art/empty-dark.png'),
    'startingsoon-light': require('../../assets/widget-art/startingsoon-light.png'),
    'startingsoon-dark': require('../../assets/widget-art/startingsoon-dark.png'),
  };

  const { Asset } = require('expo-asset') as typeof import('expo-asset');
  const { File } =
    require('expo-file-system') as typeof import('expo-file-system');

  for (const [name, mod] of Object.entries(sources) as [
    WidgetArtName,
    number,
  ][]) {
    try {
      const asset = Asset.fromModule(mod);
      const destination = new File(
        directory,
        `${name}-${asset.hash ?? 'nohash'}.png`
      );
      if (!destination.exists) {
        // Resolves immediately for an asset already on disk; in a dev client
        // it pulls the file down off Metro first.
        await asset.downloadAsync();
        if (!asset.localUri) continue;
        await new File(asset.localUri).copy(destination);
      }
      uris.set(name, destination.uri);
    } catch (error) {
      reportWidgetFailure(`widgetArt:${name}`, error);
    }
  }
}
