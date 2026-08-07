/**
 * @module domains/timesheet/__tests__/weekExport.test
 *
 * The ONE module in this domain that touches native (`expo-print`,
 * `expo-sharing`, `expo-file-system`). Everything else imports it, so
 * everything else can mock this single seam instead of three native
 * packages — the same isolate-the-native-boundary shape `openExternalUrl`
 * uses (GOLDEN-FIXES #4).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const writeMock = mock((_contents: string) => {});
const createMock = mock((_options?: unknown) => {});
const deleteMock = mock(() => {});
let fileExists = false;
const fileInstances: { name: string }[] = [];

mock.module('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    name: string;
    uri: string;
    get exists() {
      return fileExists;
    }
    constructor(_dir: unknown, name: string) {
      this.name = name;
      this.uri = `file:///cache/${name}`;
      fileInstances.push({ name });
    }
    create(options?: unknown) {
      createMock(options);
    }
    write(contents: string) {
      writeMock(contents);
    }
    delete() {
      deleteMock();
    }
  },
}));

const isAvailableMock = mock(() => Promise.resolve(true));
const shareAsyncMock = mock((_uri: string, _options?: unknown) =>
  Promise.resolve()
);
mock.module('expo-sharing', () => ({
  isAvailableAsync: isAvailableMock,
  shareAsync: shareAsyncMock,
}));

const printToFileAsyncMock = mock((_options: unknown) =>
  Promise.resolve({ uri: 'file:///cache/print-1234.pdf' })
);
mock.module('expo-print', () => ({
  printToFileAsync: printToFileAsyncMock,
}));

let weekExportFileName: typeof import('../utils/weekExport').weekExportFileName;
let shareCsv: typeof import('../utils/weekExport').shareCsv;
let sharePdfFromHtml: typeof import('../utils/weekExport').sharePdfFromHtml;
let ExportUnavailableError: typeof import('../utils/weekExport').ExportUnavailableError;

beforeAll(async () => {
  const mod = await import('../utils/weekExport');
  weekExportFileName = mod.weekExportFileName;
  shareCsv = mod.shareCsv;
  sharePdfFromHtml = mod.sharePdfFromHtml;
  ExportUnavailableError = mod.ExportUnavailableError;
});

beforeEach(() => {
  writeMock.mockClear();
  createMock.mockClear();
  deleteMock.mockClear();
  isAvailableMock.mockClear();
  shareAsyncMock.mockClear();
  printToFileAsyncMock.mockClear();
  fileInstances.length = 0;
  fileExists = false;
  isAvailableMock.mockImplementation(() => Promise.resolve(true));
});

describe('weekExportFileName', () => {
  it('builds a name a human can recognise in a share sheet', () => {
    expect(weekExportFileName('Amara Okafor', '2026-08-03', 'csv')).toBe(
      'Amara-Okafor-2026-08-03.csv'
    );
  });

  it('strips anything that is not safe in a filename, rather than trusting a display name', () => {
    expect(weekExportFileName('Ana / Co: "the 2nd"', '2026-08-03', 'pdf')).toBe(
      'Ana-Co-the-2nd-2026-08-03.pdf'
    );
  });

  it('falls back to a generic stem when the name reduces to nothing', () => {
    expect(weekExportFileName('///', '2026-08-03', 'csv')).toBe(
      'week-2026-08-03.csv'
    );
  });
});

describe('shareCsv', () => {
  it('writes the CSV verbatim into the cache directory and shares that file', async () => {
    await shareCsv('Amara-2026-08-03.csv', 'date,amount_minor\n', 'Export');

    expect(fileInstances[0]?.name).toBe('Amara-2026-08-03.csv');
    expect(createMock).toHaveBeenCalledWith({
      overwrite: true,
      intermediates: true,
    });
    expect(writeMock).toHaveBeenCalledWith('date,amount_minor\n');
    expect(shareAsyncMock).toHaveBeenCalledWith(
      'file:///cache/Amara-2026-08-03.csv',
      expect.objectContaining({ mimeType: 'text/csv', dialogTitle: 'Export' })
    );
  });

  it('deletes a stale file of the same name first — a re-export must not append to last week', async () => {
    fileExists = true;

    await shareCsv('Amara-2026-08-03.csv', 'date\n', 'Export');

    expect(deleteMock).toHaveBeenCalled();
  });

  it('throws ExportUnavailableError, and writes nothing, when the device cannot share', async () => {
    isAvailableMock.mockImplementation(() => Promise.resolve(false));

    await expect(shareCsv('a.csv', 'x', 'Export')).rejects.toBeInstanceOf(
      ExportUnavailableError
    );
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe('sharePdfFromHtml', () => {
  it('renders the HTML to a PDF and shares the file the printer produced', async () => {
    await sharePdfFromHtml('<!DOCTYPE html><html></html>', 'Export');

    expect(printToFileAsyncMock).toHaveBeenCalledWith({
      html: '<!DOCTYPE html><html></html>',
      base64: false,
    });
    expect(shareAsyncMock).toHaveBeenCalledWith(
      'file:///cache/print-1234.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' })
    );
  });

  it('throws ExportUnavailableError before printing when the device cannot share', async () => {
    isAvailableMock.mockImplementation(() => Promise.resolve(false));

    await expect(
      sharePdfFromHtml('<html></html>', 'Export')
    ).rejects.toBeInstanceOf(ExportUnavailableError);
    expect(printToFileAsyncMock).not.toHaveBeenCalled();
  });
});
