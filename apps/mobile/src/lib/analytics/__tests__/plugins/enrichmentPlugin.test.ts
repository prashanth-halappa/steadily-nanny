/**
 * EnrichmentPlugin Test Suite
 *
 * Tests for the automatic context enrichment plugin.
 */

import { describe, expect, it } from 'bun:test';
import type { AnalyticsContext, AnalyticsEvent } from '../../core/types';
import { createEnrichmentPlugin } from '../../plugins/enrichmentPlugin';

describe('enrichmentPlugin', () => {
  const baseEvent: AnalyticsEvent = {
    name: 'test_event',
    properties: { custom: 'prop' },
    timestamp: 1234567890,
  };

  describe('beforeTrack', () => {
    it('should add user context to event properties', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        user: { id: 'user-123', email: 'test@example.com', provider: 'email' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toMatchObject({
        user_id: 'user-123',
        custom: 'prop',
      });
    });

    it('should add entity context to event properties', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        entity: { id: 'entity-456', bucket: 'tier-a', label: 'Acme' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toMatchObject({
        entity_id: 'entity-456',
        entity_bucket: 'tier-a',
        custom: 'prop',
      });
    });

    it('should add screen context to event properties', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        screen: { current: 'HomeScreen', previous: 'LoginScreen' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toMatchObject({
        screen_name: 'HomeScreen',
        previous_screen: 'LoginScreen',
        custom: 'prop',
      });
    });

    it('should add device context to event properties', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        device: { platform: 'ios', model: 'iPhone 14' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toMatchObject({
        platform: 'ios',
        device_model: 'iPhone 14',
        custom: 'prop',
      });
    });

    it('should combine all contexts', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        user: { id: 'user-123' },
        entity: { id: 'entity-456', bucket: 'tier-b' },
        screen: { current: 'Home' },
        device: { platform: 'android' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toMatchObject({
        user_id: 'user-123',
        entity_id: 'entity-456',
        entity_bucket: 'tier-b',
        screen_name: 'Home',
        platform: 'android',
        custom: 'prop',
      });
    });

    it('should not add undefined values', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        user: { id: 'user-123' },
        // No entity, screen, device
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).toHaveProperty('user_id', 'user-123');
      expect(result?.properties).not.toHaveProperty('entity_id');
      expect(result?.properties).not.toHaveProperty('screen_name');
    });

    it('should not override existing properties with context', () => {
      const plugin = createEnrichmentPlugin();
      const eventWithUserId: AnalyticsEvent = {
        name: 'test_event',
        properties: { user_id: 'explicit-user' },
        timestamp: 1234567890,
      };
      const context: AnalyticsContext = { user: { id: 'context-user' } };

      const result = plugin.beforeTrack?.(eventWithUserId, context);

      // Explicit property should NOT be overridden
      expect(result?.properties?.user_id).toBe('explicit-user');
    });

    it('should handle empty context', () => {
      const plugin = createEnrichmentPlugin();
      const result = plugin.beforeTrack?.(baseEvent, {});
      expect(result).toEqual(baseEvent);
    });

    it('should handle event with no properties', () => {
      const plugin = createEnrichmentPlugin();
      const eventNoProps: AnalyticsEvent = {
        name: 'simple_event',
        timestamp: 1234567890,
      };
      const context: AnalyticsContext = { user: { id: 'user-123' } };

      const result = plugin.beforeTrack?.(eventNoProps, context);

      expect(result?.properties).toMatchObject({ user_id: 'user-123' });
    });

    it('should NOT include the entity label in enriched properties', () => {
      const plugin = createEnrichmentPlugin();
      const context: AnalyticsContext = {
        entity: { id: 'entity-789', bucket: 'tier-a', label: 'Acme' },
      };

      const result = plugin.beforeTrack?.(baseEvent, context);

      expect(result?.properties).not.toHaveProperty('entity_label');
      expect(result?.properties).toHaveProperty('entity_bucket', 'tier-a');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      const plugin = createEnrichmentPlugin();
      expect(plugin.name).toBe('enrichment');
    });
  });
});
