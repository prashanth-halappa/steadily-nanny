/**
 * @module domains/schedule/utils/calendarSync
 *
 * Pure device-calendar sync helpers: marker format, event rendering, and the
 * create/update/delete diff. No expo-calendar — the runner imports this.
 */

export const MARKER = (icalUid: string): string => `[steadily:${icalUid}]`;

const MARKER_RE = /\[steadily:([^\]]+)\]/;

export function parseMarker(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = MARKER_RE.exec(notes);
  return match?.[1] ?? null;
}

const SYNCABLE = new Set(['confirmed', 'pending']);

export function isSyncableStatus(status: string): boolean {
  return SYNCABLE.has(status);
}

export type SyncRole = 'nanny' | 'parent';

/** Localised fragments for calendar event titles/notes — keep renderEvent pure. */
export interface CalendarEventLabels {
  childcare: string;
  pendingConfirmation: string;
}

export const DEFAULT_CALENDAR_EVENT_LABELS: CalendarEventLabels = {
  childcare: 'Childcare',
  pendingConfirmation: 'Pending confirmation',
};

export interface RenderEventInput {
  icalUid: string;
  status: string;
  startsAt: string;
  endsAt: string;
  childNames: string[];
  householdName: string;
  carerName: string | null;
  role: SyncRole;
  labels?: CalendarEventLabels;
}

export interface DesiredEvent {
  icalUid: string;
  title: string;
  notes: string;
  startMs: number;
  endMs: number;
}

export interface ExistingDeviceEvent {
  id: string;
  icalUid: string;
  title: string;
  notes: string;
  startMs: number;
  endMs: number;
}

function formatChildNames(childNames: string[]): string {
  return childNames.filter(name => name.trim().length > 0).join(', ');
}

function renderTitle(
  input: RenderEventInput,
  labels: CalendarEventLabels
): string {
  const children = formatChildNames(input.childNames);

  if (input.role === 'nanny') {
    if (children.length > 0) {
      return `${labels.childcare}: ${children} (${input.householdName})`;
    }
    return `${labels.childcare} (${input.householdName})`;
  }

  const carer = input.carerName?.trim() || labels.childcare;
  if (children.length > 0) {
    return `${carer} — ${children}`;
  }
  return carer;
}

function renderNotes(
  status: string,
  icalUid: string,
  labels: CalendarEventLabels
): string {
  const marker = MARKER(icalUid);
  if (status === 'pending') {
    return `${labels.pendingConfirmation}\n${marker}`;
  }
  return marker;
}

export function renderEvent(input: RenderEventInput): DesiredEvent {
  const labels = input.labels ?? DEFAULT_CALENDAR_EVENT_LABELS;
  return {
    icalUid: input.icalUid,
    title: renderTitle(input, labels),
    notes: renderNotes(input.status, input.icalUid, labels),
    startMs: new Date(input.startsAt).getTime(),
    endMs: new Date(input.endsAt).getTime(),
  };
}

export function diffCalendarEvents(
  desired: DesiredEvent[],
  existing: ExistingDeviceEvent[]
): {
  create: DesiredEvent[];
  update: { id: string; event: DesiredEvent }[];
  deleteIds: string[];
} {
  const desiredByUid = new Map(desired.map(event => [event.icalUid, event]));
  const existingByUid = new Map(existing.map(event => [event.icalUid, event]));

  const create: DesiredEvent[] = [];
  const update: { id: string; event: DesiredEvent }[] = [];
  const deleteIds: string[] = [];

  for (const event of desired) {
    const onDevice = existingByUid.get(event.icalUid);
    if (!onDevice) {
      create.push(event);
      continue;
    }
    if (
      onDevice.title !== event.title ||
      onDevice.notes !== event.notes ||
      onDevice.startMs !== event.startMs ||
      onDevice.endMs !== event.endMs
    ) {
      update.push({ id: onDevice.id, event });
    }
  }

  for (const onDevice of existing) {
    if (!desiredByUid.has(onDevice.icalUid)) {
      deleteIds.push(onDevice.id);
    }
  }

  return { create, update, deleteIds };
}
