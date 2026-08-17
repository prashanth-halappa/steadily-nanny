import { describe, expect, it } from 'bun:test';
import { serializeTree } from '../renderWithProviders';

describe('serializeTree', () => {
  it('does not throw on a genuinely cyclic object and still serializes its other props', () => {
    const cyclicObj: Record<string, unknown> = { className: 'bg-primary' };
    cyclicObj.self = cyclicObj;

    const result = serializeTree(cyclicObj);
    expect(result).toBe('{"className":"bg-primary"}');
  });

  it('serializes shared objects in sibling branches without dropping them (non-lossy)', () => {
    const shared = { className: 'bg-primary' };
    const tree = { children: [{ props: shared }, { props: shared }] };

    const result = serializeTree(tree);
    expect(result).toBe(
      '{"children":[{"props":{"className":"bg-primary"}},{"props":{"className":"bg-primary"}}]}'
    );
    const matches = result.match(/bg-primary/g);
    expect(matches?.length).toBe(2);
  });

  it('serializes plain acyclic objects identically to JSON.stringify', () => {
    const tree = {
      a: 1,
      b: 'hello',
      c: [true, false, null],
      d: { nested: 42 },
    };

    const result = serializeTree(tree);
    expect(result).toBe(JSON.stringify(tree));
  });
});
