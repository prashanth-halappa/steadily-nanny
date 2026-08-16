/**
 * @module domains/today/utils/todayLead
 *
 * One true sentence under Today's date line. The seven `today:lead.*` locale
 * keys already exist; this resolver only chooses among them. Mood is the
 * same `HeroMood` the hero illustration uses — nanny `quiet` splits into
 * `scheduled` vs `quiet` when a cover row is still ahead today. Returns
 * null when nothing true can be said (no household, no matching role, or
 * a key that would need a name/time the caller cannot supply).
 */
import type { CoverKind } from '../hooks/useTodayCoverRows';
import type { HeroMood } from './heroMood';

export interface TodayLead {
  key: string;
  params: Record<string, string | number>;
}

export interface TodayLeadRow {
  name: string;
  kind: CoverKind;
  detail?: string;
}

export interface TodayLeadInput {
  hasHousehold: boolean;
  isParentView: boolean;
  activeNanny: boolean;
  mood: HeroMood;
  rows: readonly TodayLeadRow[];
  name?: string;
  time?: string;
  duration?: string;
  family?: string;
  start?: string;
  end?: string;
}

const UPCOMING: ReadonlySet<CoverKind> = new Set(['scheduled', 'arriving']);

const CLOCK_RE = /\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?/g;

export function resolveTodayLead(input: TodayLeadInput): TodayLead | null {
  if (!input.hasHousehold) return null;
  if (!input.isParentView && !input.activeNanny) return null;

  if (input.activeNanny) return resolveNannyLead(input);
  return resolveParentLead(input);
}

function resolveParentLead(input: TodayLeadInput): TodayLead | null {
  switch (input.mood) {
    case 'here': {
      const name = input.name ?? liveName(input);
      if (!name) return null;
      return { key: 'lead.parent.here', params: { name } };
    }
    case 'done':
      return { key: 'lead.parent.done', params: {} };
    case 'quiet':
      // "Nothing scheduled today" is only true when nothing is still ahead.
      if (input.rows.some(row => UPCOMING.has(row.kind))) return null;
      return { key: 'lead.parent.quiet', params: {} };
  }
}

function resolveNannyLead(input: TodayLeadInput): TodayLead | null {
  switch (input.mood) {
    case 'here': {
      const time = input.time ?? clockTimeFrom(input, 'live');
      if (!time) return null;
      return { key: 'lead.nanny.here', params: { time } };
    }
    case 'done': {
      const time = input.time ?? clockTimeFrom(input, 'finished');
      const duration = input.duration ?? durationFrom(input);
      if (!time || !duration) return null;
      return { key: 'lead.nanny.done', params: { time, duration } };
    }
    case 'quiet': {
      if (!input.rows.some(row => UPCOMING.has(row.kind))) {
        return { key: 'lead.nanny.quiet', params: {} };
      }
      const family = input.family;
      const { start, end } = windowFrom(input);
      const resolvedStart = input.start ?? start;
      const resolvedEnd = input.end ?? end;
      if (!family || !resolvedStart || !resolvedEnd) return null;
      return {
        key: 'lead.nanny.scheduled',
        params: { family, start: resolvedStart, end: resolvedEnd },
      };
    }
  }
}

function liveName(input: TodayLeadInput): string | undefined {
  return input.rows.find(row => row.kind === 'live')?.name;
}

function clockTimes(detail: string | undefined): string[] {
  if (!detail) return [];
  return detail.match(CLOCK_RE) ?? [];
}

function clockTimeFrom(
  input: TodayLeadInput,
  kind: CoverKind
): string | undefined {
  const found = input.rows.find(row => row.kind === kind);
  return clockTimes(found?.detail)[0];
}

function durationFrom(input: TodayLeadInput): string | undefined {
  const found = input.rows.find(row => row.kind === 'finished');
  const duration = found?.detail?.split(' · ')[1]?.trim();
  return duration ? duration : undefined;
}

function windowFrom(input: TodayLeadInput): {
  start: string | undefined;
  end: string | undefined;
} {
  const found = input.rows.find(row => UPCOMING.has(row.kind));
  const times = clockTimes(found?.detail);
  return { start: times[0], end: times[1] };
}
