-- Add privacy-conscious review prompt events to the existing native app analytics allowlist.
-- The mobile feature remains functional if this migration has not yet been applied;
-- analytics writes are already best-effort and never block review or inventory flows.

BEGIN;

ALTER TABLE public.app_analytics_events
  DROP CONSTRAINT IF EXISTS app_analytics_events_event_name_check,
  ADD CONSTRAINT app_analytics_events_event_name_check CHECK (
    event_name = ANY (ARRAY[
      'app_opened',
      'app_foregrounded',
      'property_created',
      'room_created',
      'item_created_manually',
      'scan_started',
      'scan_completed',
      'scan_failed',
      'replacement_search_started',
      'replacement_search_completed',
      'replacement_search_failed',
      'claim_pack_started',
      'claim_pack_completed',
      'claim_pack_failed',
      'paywall_viewed',
      'purchase_started',
      'purchase_completed',
      'purchase_failed',
      'purchase_restored',
      'review_prompt_eligible',
      'review_prompt_requested',
      'review_store_link_opened'
    ])
  ),
  DROP CONSTRAINT IF EXISTS app_analytics_events_properties_keys_check,
  ADD CONSTRAINT app_analytics_events_properties_keys_check CHECK (
    properties - ARRAY[
      'is_first_open',
      'authenticated',
      'property_count',
      'room_count',
      'entry_method',
      'scan_mode',
      'image_count',
      'items_detected_count',
      'duration_ms',
      'failure_category',
      'credit_cost',
      'result_count',
      'refined_search_used',
      'credit_refunded',
      'item_count',
      'evidence_file_count',
      'delivery_method',
      'plan',
      'billing_period',
      'product_identifier',
      'source_screen',
      'trigger',
      'successful_scan_count',
      'store_platform'
    ]::text[] = '{}'::jsonb
  );

COMMIT;
