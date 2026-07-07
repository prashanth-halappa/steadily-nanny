import { describe, expect, it } from 'bun:test';
import {
  CreateWidgetSchema,
  UpdateWidgetSchema,
  type Widget,
  WidgetDescriptionSchema,
  WidgetIdParamSchema,
  WidgetSchema,
} from '../src/schemas/widget.schema';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

const validWidget = {
  id: UUID,
  owner_id: UUID,
  name: 'My widget',
  description: null,
  tags: ['a', 'b'],
  created_at: '2026-07-07T00:00:00.000Z',
  updated_at: '2026-07-07T00:00:00.000Z',
};

describe('WidgetSchema', () => {
  it('parses a valid widget and infers the Widget type', () => {
    const parsed: Widget = WidgetSchema.parse(validWidget);
    expect(parsed.id).toBe(UUID);
    expect(parsed.tags).toEqual(['a', 'b']);
  });

  it('accepts a string description', () => {
    const parsed = WidgetSchema.parse({ ...validWidget, description: 'hello' });
    expect(parsed.description).toBe('hello');
  });

  it('rejects a non-uuid id', () => {
    expect(
      WidgetSchema.safeParse({ ...validWidget, id: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(WidgetSchema.safeParse({ ...validWidget, name: '' }).success).toBe(
      false
    );
  });

  it('rejects a missing tags array', () => {
    const noTags = {
      id: UUID,
      owner_id: UUID,
      name: 'My widget',
      description: null,
      created_at: '2026-07-07T00:00:00.000Z',
      updated_at: '2026-07-07T00:00:00.000Z',
    };
    expect(WidgetSchema.safeParse(noTags).success).toBe(false);
  });
});

describe('CreateWidgetSchema', () => {
  it('parses a valid create body', () => {
    expect(CreateWidgetSchema.parse({ name: 'Fresh' }).name).toBe('Fresh');
  });

  it('rejects an empty name', () => {
    expect(CreateWidgetSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a name longer than 80 chars', () => {
    expect(CreateWidgetSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(
      false
    );
  });
});

describe('UpdateWidgetSchema', () => {
  it('accepts a name-only update', () => {
    expect(UpdateWidgetSchema.safeParse({ name: 'Renamed' }).success).toBe(
      true
    );
  });

  it('accepts a description-only update, including null', () => {
    expect(UpdateWidgetSchema.safeParse({ description: 'new' }).success).toBe(
      true
    );
    expect(UpdateWidgetSchema.safeParse({ description: null }).success).toBe(
      true
    );
  });

  it('rejects an empty update (no fields)', () => {
    expect(UpdateWidgetSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a name longer than 80 chars', () => {
    expect(UpdateWidgetSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(
      false
    );
  });
});

describe('WidgetDescriptionSchema', () => {
  it('parses structured LLM output', () => {
    const out = WidgetDescriptionSchema.parse({
      description: 'A gadget',
      tags: ['x'],
    });
    expect(out.tags).toEqual(['x']);
  });

  it('rejects when tags are missing', () => {
    expect(
      WidgetDescriptionSchema.safeParse({ description: 'A gadget' }).success
    ).toBe(false);
  });
});

describe('WidgetIdParamSchema', () => {
  it('parses a valid uuid param', () => {
    expect(WidgetIdParamSchema.safeParse({ widgetId: UUID }).success).toBe(
      true
    );
  });

  it('rejects a non-uuid param', () => {
    expect(WidgetIdParamSchema.safeParse({ widgetId: '123' }).success).toBe(
      false
    );
  });
});
