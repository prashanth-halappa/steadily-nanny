import { describe, expect, it } from 'bun:test';
import { createV1Migrate } from '../persistMigrations';

interface Shape {
  a: number;
}

describe('createV1Migrate', () => {
  it('identity-maps version 0 so existing installs keep their state', () => {
    const migrate = createV1Migrate<Shape>();
    expect(migrate({ a: 1 }, 0)).toEqual({ a: 1 });
  });

  it('identity-maps version 1', () => {
    const migrate = createV1Migrate<Shape>();
    expect(migrate({ a: 2 }, 1)).toEqual({ a: 2 });
  });

  it('falls back to initial for an unknown/newer version', () => {
    const migrate = createV1Migrate<Shape>(() => ({ a: 99 }));
    expect(migrate({ a: 5 }, 2)).toEqual({ a: 99 });
  });

  it('falls back when persisted is null even at a known version', () => {
    const migrate = createV1Migrate<Shape>(() => ({ a: 7 }));
    expect(migrate(null, 1)).toEqual({ a: 7 });
  });

  it('defaults the fallback to an empty object', () => {
    const migrate = createV1Migrate<Shape>();
    expect(migrate(undefined, 3)).toEqual({} as Shape);
  });
});
