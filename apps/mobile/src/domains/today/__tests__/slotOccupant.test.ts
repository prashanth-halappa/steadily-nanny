/**
 * @module domains/today/__tests__/slotOccupant.test
 *
 * The pinned slot holds AT MOST ONE thing, so "what is in it" has to be one
 * pure answer, not a stack of `&&`s spread through a screen. This file is
 * that answer's contract: given a role, a membership, whether she is on the
 * clock, and the attention ladder's verdict, exactly one occupant (or none).
 */
import { describe, expect, it } from 'bun:test';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { resolveSlotOccupant } from '../utils/slotOccupant';

describe('resolveSlotOccupant', () => {
  it('an active nanny on an ordinary day gets the clock-in card', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: false,
        onClock: false,
        attentionOwner: null,
      })
    ).toBe('clockIn');
  });

  // Every write on a household she was removed from 403s server-side, so a
  // clock-in button there would only ever fail.
  it('a past member gets an empty slot', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: true,
        onClock: false,
        attentionOwner: null,
      })
    ).toBeNull();
  });

  // Hers is the clock; his is today's cover. An ordinary day is still a day
  // someone is looking after his children, and that is the one thing he opens
  // this screen to read.
  it('a parent on an ordinary day gets the coverage surface', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.PARENT,
        isPastMember: false,
        onClock: false,
        attentionOwner: null,
      })
    ).toBe('coverage');
  });

  // A helper sees the parent-facing Today (read-only), so she sees the same
  // cover — the gate is `canViewParentSchedule`, not `role === PARENT`.
  it('a helper gets the coverage surface too', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.HELPER,
        isPastMember: false,
        onClock: false,
        attentionOwner: null,
      })
    ).toBe('coverage');
  });

  // `isPastMember` exists to withhold the CLOCK, whose every write on a
  // household she left would 403. Reading who is covering today is not a
  // write, and it is the only thing the parent side of the slot does.
  it('a past-member parent keeps the coverage surface, never the clock', () => {
    const occupant = resolveSlotOccupant({
      role: SETUP_ROLES.PARENT,
      isPastMember: true,
      onClock: true,
      attentionOwner: null,
    });
    expect(occupant).toBe('coverage');
    expect(occupant).not.toBe('clockIn');
  });

  // A running timer is the one thing she is doing RIGHT NOW; an inbox item
  // waits safely for the length of a scroll.
  it('a running clock beats every T1 the ladder can name', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: false,
        onClock: true,
        attentionOwner: 'inbox',
      })
    ).toBe('clockIn');
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: false,
        onClock: true,
        attentionOwner: 'termsProposal',
      })
    ).toBe('clockIn');
  });

  it('a terms block owns the slot even while a timer runs', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: false,
        onClock: true,
        attentionOwner: 'termsBlocked',
      })
    ).toBe('blockedClockIn');
  });

  it('an overdue clock-out puts the clock card in the slot', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: false,
        onClock: false,
        attentionOwner: 'overdue',
      })
    ).toBe('clockIn');
  });

  it('a parent with a coverage gap gets the coverage surface', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.PARENT,
        isPastMember: false,
        onClock: false,
        attentionOwner: 'uncoveredCare',
      })
    ).toBe('coverageGap');
  });

  it('a terms proposal and an inbox item each own the slot in turn', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.PARENT,
        isPastMember: false,
        onClock: false,
        attentionOwner: 'termsProposal',
      })
    ).toBe('termsProposal');
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.PARENT,
        isPastMember: false,
        onClock: false,
        attentionOwner: 'inbox',
      })
    ).toBe('inbox');
  });

  // A past member still has an inbox (a queried week she can still answer),
  // so the ladder's verdict survives — only the nanny-only default drops.
  it('keeps a ladder verdict for a past member, but never the clock', () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: true,
        onClock: false,
        attentionOwner: 'inbox',
      })
    ).toBe('inbox');
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.NANNY,
        isPastMember: true,
        onClock: true,
        attentionOwner: null,
      })
    ).toBeNull();
  });

  // A7 — the parent's pending offer, and only while it is BLOCKING. A stale
  // offer never reaches the ladder at all, so it never reaches this slot.
  it("a blocking sent offer puts the parent's pending-offer card in the slot", () => {
    expect(
      resolveSlotOccupant({
        role: SETUP_ROLES.PARENT,
        isPastMember: false,
        onClock: false,
        attentionOwner: 'sentOfferBlocking',
      })
    ).toBe('pendingOffer');
  });

  it('a role that has not resolved yet gets an empty slot', () => {
    expect(
      resolveSlotOccupant({
        role: null,
        isPastMember: false,
        onClock: false,
        attentionOwner: null,
      })
    ).toBeNull();
  });
});
