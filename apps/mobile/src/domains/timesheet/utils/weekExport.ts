/**
 * @module domains/timesheet/utils/weekExport
 *
 * THE native boundary for "share this week" — the only module in the app
 * that imports `expo-print`, `expo-sharing` or `expo-file-system`. Every
 * caller (and every caller's test) therefore mocks ONE seam instead of three
 * native packages, the same isolate-the-native-call shape
 * `utils/openExternalUrl.ts` uses for `Linking` (GOLDEN-FIXES #4).
 *
 * All three are plugin-free Expo modules: `expo-print` and `expo-file-system`
 * ship no `app.plugin.js` at all, and `expo-sharing`'s exists solely to build
 * an iOS/Android SHARE-EXTENSION target (receiving shares INTO the app) —
 * both `ios.enabled` and `android.enabled` default to false, and we only
 * share OUT. Nothing is added to `app.config.js`; autolinking finds all three
 * through their `expo-module.config.json`.
 *
 * The three native packages are imported LAZILY, inside the functions that
 * use them, rather than at module scope. `expo-file-system` throws
 * "Cannot find native module 'FileSystem'" the moment it is imported under
 * `bun:test`, and a top-level import made that failure transitive: every
 * existing test that renders a week view — none of which export anything —
 * started failing on an import it never asked for. Deferring the import
 * keeps the blast radius to the code paths that genuinely need native, and
 * on device it costs one resolution the first time somebody taps Export.
 *
 * Files are written to the CACHE directory, never documents: an export is a
 * disposable artefact on its way to a share sheet, and the OS may reclaim it
 * whenever it likes. A stale file of the same name is deleted before writing
 * rather than appended to — a second export of the same week must not
 * produce a document containing the first one.
 */

/**
 * The device has no share sheet (or `expo-sharing` is unavailable). Its own
 * class so the caller can say "sharing isn't available on this device"
 * instead of the generic "couldn't prepare the export" — one of those is
 * actionable and the other is not.
 */
export class ExportUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device');
    this.name = 'ExportUnavailableError';
  }
}

/** Anything that is not a letter, digit or dash collapses to a single dash. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `"Amara Okafor" + "2026-08-03" -> "Amara-Okafor-2026-08-03.csv"`. The name
 * lands in the recipient's Files app / mail attachment, so it is built to be
 * recognised by a human — but from a DISPLAY NAME, which is arbitrary
 * user-supplied text, so everything unsafe is stripped rather than trusted.
 * A name that reduces to nothing falls back to a generic stem instead of
 * emitting a file called `-2026-08-03.csv`.
 */
export function weekExportFileName(
  carerName: string,
  weekStartISO: string,
  extension: 'csv' | 'pdf'
): string {
  const stem = slugify(carerName) || 'week';
  return `${stem}-${weekStartISO}.${extension}`;
}

async function assertSharingAvailable(): Promise<
  typeof import('expo-sharing')
> {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new ExportUnavailableError();
  }
  return Sharing;
}

/**
 * Writes `contents` to a cache file and opens the share sheet on it.
 * `contents` is the server's CSV body VERBATIM — the column order and the
 * summary rows are the server's contract, and re-assembling them here would
 * be a second implementation of the same figures.
 */
export async function shareCsv(
  fileName: string,
  contents: string,
  dialogTitle: string
): Promise<void> {
  const Sharing = await assertSharingAvailable();
  const { File, Paths } = await import('expo-file-system');

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create({ overwrite: true, intermediates: true });
  file.write(contents);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    // iOS routes on the UTI, not the MIME type — without it the sheet
    // offers far fewer destinations for a .csv.
    UTI: 'public.comma-separated-values-text',
    dialogTitle,
  });
}

/** Renders `html` to a PDF in the cache directory and shares that file. */
export async function sharePdfFromHtml(
  html: string,
  dialogTitle: string
): Promise<void> {
  const Sharing = await assertSharingAvailable();
  const Print = await import('expo-print');

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle,
  });
}
