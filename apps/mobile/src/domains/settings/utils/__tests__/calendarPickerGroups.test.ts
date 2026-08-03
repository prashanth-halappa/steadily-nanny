/**
 * @module domains/settings/utils/__tests__/calendarPickerGroups.test
 */
import { describe, expect, it } from 'bun:test';
import {
  groupCalendarsBySource,
  hasNonLocalWritableCalendar,
} from '../calendarPickerGroups';

describe('groupCalendarsBySource', () => {
  it('groups by source and puts non-local first', () => {
    const groups = groupCalendarsBySource([
      {
        id: '1',
        title: 'Calendar',
        sourceName: 'On My iPhone',
        sourceType: 'local',
        isLocal: true,
      },
      {
        id: '2',
        title: 'Family',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
      },
      {
        id: '3',
        title: 'Work',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
      },
    ]);
    expect(groups.map(g => g.sourceName)).toEqual(['Google', 'On My iPhone']);
    expect(groups[0]?.calendars).toHaveLength(2);
  });
});

describe('hasNonLocalWritableCalendar', () => {
  it('is false when only local calendars exist', () => {
    expect(
      hasNonLocalWritableCalendar([
        {
          id: '1',
          title: 'Calendar',
          sourceName: 'On My iPhone',
          sourceType: 'local',
          isLocal: true,
        },
      ])
    ).toBe(false);
  });

  it('is true when a Google source exists', () => {
    expect(
      hasNonLocalWritableCalendar([
        {
          id: '2',
          title: 'Family',
          sourceName: 'Google',
          sourceType: 'com.google',
          isLocal: false,
        },
      ])
    ).toBe(true);
  });
});
