-- Baseline reconstructed from the Coverly PROD architecture on 2026-07-26.
-- Contains schema/configuration only. No production user or inventory data.
-- Later repository migrations remain authoritative for forward changes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE SEQUENCE public.claim_evidence_items_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE public.claim_pack_tokens_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE public.claim_packs_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE public.inventory_files_file_number_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE TABLE "public"."admin_audit_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "action" text NOT NULL,
  "target_user_id" uuid,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."admin_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text,
  "screen" text,
  "severity" text DEFAULT 'info'::text NOT NULL,
  "message" text NOT NULL,
  "user_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "public"."app_settings" (
  "id" integer DEFAULT 1 NOT NULL,
  "entitlement_mode" text DEFAULT 'open'::text NOT NULL,
  "mode_changed_by" uuid,
  "mode_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "mode_change_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "diagnostics_save_performance_enabled" boolean DEFAULT false NOT NULL,
  "diagnostics_scan_detection_enabled" boolean DEFAULT false NOT NULL,
  "diagnostics_verbose_console_enabled" boolean DEFAULT false NOT NULL,
  "free_ai_scan_monthly_limit" integer DEFAULT 10 NOT NULL,
  "free_replacement_pricing_monthly_limit" integer DEFAULT 5 NOT NULL
);

CREATE TABLE "public"."claim_evidence" (
  "id" text NOT NULL,
  "file_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "created_by_email" text,
  "evidence_type" text,
  "filename" text,
  "file_url" text,
  "upload_date" timestamp with time zone DEFAULT now(),
  "document_date" date,
  "caption" text,
  "is_primary" boolean DEFAULT false,
  "include_in_pack" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."claim_evidence_items" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evidence_id" text NOT NULL,
  "item_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."claim_pack_tokens" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" uuid NOT NULL,
  "user_email" text NOT NULL,
  "status" text DEFAULT 'available'::text NOT NULL,
  "stripe_session_id" text,
  "stripe_payment_intent_id" text,
  "claim_pack_id" bigint,
  "reserved_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."claim_packs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" uuid NOT NULL,
  "user_email" text NOT NULL,
  "pack_ref" text NOT NULL,
  "scope" text,
  "items_snapshot" jsonb,
  "rooms_included" text[],
  "total_value" numeric,
  "item_count" integer,
  "claim_note" text,
  "status" text DEFAULT 'generated'::text,
  "share_token" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "draft_scope" text,
  "draft_file_id" text,
  "draft_selected_rooms" text[],
  "draft_item_states" jsonb,
  "draft_claim_note" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "storage_path" text,
  "filename" text,
  "file_size_bytes" bigint,
  "generated_at" timestamp with time zone,
  "selected_room_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "selected_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generation_error" text,
  "file_id" text,
  "country_code" text,
  "currency_code" text,
  "summary_currency" text
);

CREATE TABLE "public"."feature_usage_monthly" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "feature" text NOT NULL,
  "month_key" text NOT NULL,
  "month_start_date" date NOT NULL,
  "used_units" integer DEFAULT 0 NOT NULL,
  "reserved_units" integer DEFAULT 0 NOT NULL,
  "limit_units" integer NOT NULL,
  "effective_plan_snapshot" text,
  "entitlement_mode_snapshot" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."feature_usage_reservations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "feature" text NOT NULL,
  "operation" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "month_key" text NOT NULL,
  "month_start_date" date NOT NULL,
  "units" integer NOT NULL,
  "status" text DEFAULT 'reserved'::text NOT NULL,
  "allowed" boolean DEFAULT true NOT NULL,
  "would_have_blocked" boolean DEFAULT false NOT NULL,
  "is_limited" boolean DEFAULT true NOT NULL,
  "is_bypassed" boolean DEFAULT false NOT NULL,
  "effective_plan" text,
  "entitlement_mode" text NOT NULL,
  "limit_units" integer NOT NULL,
  "used_units_at_reservation" integer DEFAULT 0 NOT NULL,
  "reserved_units_at_reservation" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "committed_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "refund_reason" text
);

CREATE TABLE "public"."feedback_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "feedback_id" uuid NOT NULL,
  "author_type" text DEFAULT 'admin'::text NOT NULL,
  "author_id" text,
  "comment_text" text,
  "is_public" boolean DEFAULT false
);

CREATE TABLE "public"."feedback_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL,
  "sender_user_id" uuid NOT NULL,
  "sender_role" text NOT NULL,
  "body" text NOT NULL,
  "attachment_path" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone
);

CREATE TABLE "public"."feedback_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text,
  "status" text DEFAULT 'new'::text NOT NULL,
  "feedback_type" text,
  "severity" text,
  "title" text,
  "description" text,
  "expected_result" text,
  "wants_followup" boolean DEFAULT false,
  "screenshot_url" text,
  "user_id" text,
  "user_email" text,
  "user_name" text,
  "screen_name" text,
  "route" text,
  "environment" text,
  "app_version" text,
  "property_id" text,
  "file_id" text,
  "room_id" text,
  "item_id" text,
  "scan_session_id" text,
  "item_title" text,
  "detected_category" text,
  "detected_brand" text,
  "barcode" text,
  "matched_listing_id" text,
  "browser_info" text,
  "device_info" text,
  "os_info" text,
  "metadata_json" jsonb,
  "root_cause_category" text,
  "assigned_to" text,
  "github_issue_number" integer,
  "github_issue_url" text,
  "resolved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "app_build_number" text,
  "device_model" text,
  "classification" text,
  "last_activity_at" timestamp with time zone,
  "user_last_read_at" timestamp with time zone,
  "admin_last_read_at" timestamp with time zone,
  "last_user_message_at" timestamp with time zone,
  "last_admin_message_at" timestamp with time zone,
  "latest_message_preview" text
);

CREATE TABLE "public"."inventory_files" (
  "id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'New'::text NOT NULL,
  "created_date" timestamp with time zone DEFAULT now() NOT NULL,
  "last_modified" timestamp with time zone DEFAULT now() NOT NULL,
  "claimant_details" jsonb,
  "file_number" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "contents_sum_insured" numeric,
  "created_by_email" text,
  "property_type" text DEFAULT 'main_home'::text,
  "property_cover_image_url" text,
  "insurer_name" text,
  "policy_number" text,
  "country_code" text DEFAULT 'NZ'::text NOT NULL,
  "currency_code" text DEFAULT 'NZD'::text NOT NULL
);

CREATE TABLE "public"."inventory_items" (
  "id" text NOT NULL,
  "file_id" text NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "confidence" numeric,
  "estimated_price" numeric DEFAULT 0,
  "source_link" text,
  "image_url" text,
  "notes" text,
  "room" text,
  "scan_date" timestamp with time zone DEFAULT now(),
  "photo_url" text,
  "image_pin" jsonb,
  "attachments" jsonb,
  "visibility_status" text,
  "description" text,
  "barcode" text,
  "barcode_verified" boolean DEFAULT false,
  "voice_verified" boolean DEFAULT false,
  "sort_order" integer DEFAULT 0,
  "price_source_type" text DEFAULT 'estimated_gpt'::text,
  "web_listing_url" text,
  "web_listing_title" text,
  "web_listing_price" numeric,
  "web_listing_source" text,
  "web_listing_match_type" text,
  "web_listing_checked_at" timestamp with time zone,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_estimated_price" numeric(12,2),
  "quantity_estimate" text,
  "valuation_basis" text,
  "room_id" uuid,
  "brand_maker" text,
  "model_series" text,
  "condition_label" text,
  "purchase_source" text,
  "original_purchase_price" numeric(12,2),
  "purchase_year_approx" text,
  "estimated_currency" text,
  "valuation_market" text,
  "estimated_at" timestamp with time zone,
  "original_purchase_currency" text,
  "web_listing_currency" text,
  "web_listing_price_raw" text,
  "web_listing_fulfilment_type" text
);

CREATE TABLE "public"."inventory_rooms" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "file_id" text NOT NULL,
  "user_id" uuid,
  "name" text NOT NULL,
  "room_type" text,
  "sort_order" integer DEFAULT 0,
  "cover_photo_url" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "description" text,
  "archived_at" timestamp with time zone
);

CREATE TABLE "public"."pricing_markets" (
  "country_code" text NOT NULL,
  "currency_code" text NOT NULL,
  "locale" text NOT NULL,
  "search_language" text NOT NULL,
  "serper_gl" text,
  "serper_hl" text NOT NULL,
  "pricing_support_tier" text NOT NULL,
  "ai_estimates_enabled" boolean NOT NULL,
  "replacement_search_enabled" boolean NOT NULL,
  "material_item_threshold" numeric
);

CREATE TABLE "public"."referral_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "referral_code" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."referral_rewards" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "referral_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "reward_type" text NOT NULL,
  "reward_value" integer NOT NULL,
  "status" text DEFAULT 'issued'::text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."referrals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "referrer_user_id" uuid NOT NULL,
  "referred_user_id" uuid,
  "referral_code" text NOT NULL,
  "referred_email" text,
  "status" text DEFAULT 'clicked'::text NOT NULL,
  "clicked_at" timestamp with time zone,
  "signed_up_at" timestamp with time zone,
  "email_verified_at" timestamp with time zone,
  "first_room_created_at" timestamp with time zone,
  "first_scan_completed_at" timestamp with time zone,
  "qualified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "public"."revenuecat_webhook_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "app_user_id" text,
  "original_app_user_id" text,
  "profile_id" uuid,
  "environment" text,
  "store" text,
  "product_id" text,
  "entitlement_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'processing'::text NOT NULL,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);

CREATE TABLE "public"."scan_detection_performance_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scan_id" text,
  "user_id" uuid,
  "user_email" text,
  "file_id" uuid,
  "scan_mode" text,
  "photo_count" integer,
  "detected_item_count" integer,
  "scan_total_ms" integer,
  "image_preprocessing_ms" integer,
  "ai_request_payload_prepare_ms" integer,
  "ai_api_call_ms" integer,
  "ai_response_parse_ms" integer,
  "model_used" text,
  "image_count_sent_to_ai" integer,
  "estimated_payload_size_bytes" integer,
  "video_frame_extraction_ms" integer,
  "frames_extracted_count" integer,
  "frames_sent_to_ai_count" integer,
  "video_batch_ai_call_ms" integer,
  "error_stage" text,
  "error_message" text,
  "browser_user_agent" text
);

CREATE TABLE "public"."scan_performance_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "scan_id" text NOT NULL,
  "user_id" uuid,
  "user_email" text,
  "property_id" uuid,
  "room_id" uuid,
  "file_id" uuid,
  "photo_count" integer,
  "detected_item_count" integer,
  "save_total_ms" integer,
  "prepare_payload_ms" integer,
  "file_save_ms" integer,
  "photo_url_processing_ms" integer,
  "item_save_total_ms" integer,
  "item_save_count" integer,
  "item_save_avg_ms" numeric(10,1),
  "pricing_save_ms" integer,
  "room_summary_refresh_ms" integer,
  "items_reload_ms" integer,
  "store_update_ms" integer,
  "save_strategy" text,
  "error_stage" text,
  "error_message" text,
  "browser_user_agent" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."usage_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "feature" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'reserved'::text NOT NULL,
  "month_key" text NOT NULL,
  "effective_plan" text,
  "entitlement_mode" text,
  "allowed" boolean,
  "would_have_blocked" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."user_profiles" (
  "id" uuid NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "plan" text DEFAULT 'free'::text NOT NULL,
  "app_role" text DEFAULT 'customer'::text NOT NULL,
  "onboarding_status" text DEFAULT 'new'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "access_override_plan" text,
  "access_override_status" text,
  "access_override_reason" text,
  "access_override_expires_at" timestamp with time zone,
  "access_override_granted_by" uuid,
  "access_override_created_at" timestamp with time zone,
  "subscription_plan" text,
  "subscription_period_end" timestamp with time zone,
  "subscription_status" text,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "country_code" text,
  "reminder_notifications_enabled" boolean DEFAULT false NOT NULL,
  "product_updates_enabled" boolean DEFAULT false NOT NULL,
  "revenuecat_customer_id" text,
  "revenuecat_product_id" text,
  "revenuecat_entitlement_id" text,
  "revenuecat_expiration_at" timestamp with time zone,
  "revenuecat_status" text,
  "revenuecat_last_event_id" text,
  "revenuecat_updated_at" timestamp with time zone
);

ALTER TABLE "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."admin_events"
  ADD CONSTRAINT "admin_events_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."claim_evidence"
  ADD CONSTRAINT "claim_evidence_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."claim_evidence_items"
  ADD CONSTRAINT "claim_evidence_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."claim_pack_tokens"
  ADD CONSTRAINT "claim_pack_tokens_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."claim_packs"
  ADD CONSTRAINT "claim_packs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."feedback_comments"
  ADD CONSTRAINT "feedback_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."feedback_messages"
  ADD CONSTRAINT "feedback_messages_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."feedback_reports"
  ADD CONSTRAINT "feedback_reports_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."inventory_rooms"
  ADD CONSTRAINT "inventory_rooms_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."pricing_markets"
  ADD CONSTRAINT "pricing_markets_pkey" PRIMARY KEY (country_code);

ALTER TABLE "public"."referral_codes"
  ADD CONSTRAINT "referral_codes_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."referral_rewards"
  ADD CONSTRAINT "referral_rewards_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."referrals"
  ADD CONSTRAINT "referrals_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."revenuecat_webhook_events"
  ADD CONSTRAINT "revenuecat_webhook_events_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."scan_detection_performance_logs"
  ADD CONSTRAINT "scan_detection_performance_logs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."scan_performance_logs"
  ADD CONSTRAINT "scan_performance_logs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."usage_events"
  ADD CONSTRAINT "usage_events_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."claim_evidence_items"
  ADD CONSTRAINT "claim_evidence_items_evidence_id_item_id_key" UNIQUE (evidence_id, item_id);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_user_feature_month_unique" UNIQUE (user_id, feature, month_key);

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_user_feature_key_unique" UNIQUE (user_id, feature, idempotency_key);

ALTER TABLE "public"."pricing_markets"
  ADD CONSTRAINT "pricing_markets_country_code_currency_code_key" UNIQUE (country_code, currency_code);

ALTER TABLE "public"."referral_codes"
  ADD CONSTRAINT "referral_codes_referral_code_key" UNIQUE (referral_code);

ALTER TABLE "public"."revenuecat_webhook_events"
  ADD CONSTRAINT "revenuecat_webhook_events_event_id_key" UNIQUE (event_id);

ALTER TABLE "public"."usage_events"
  ADD CONSTRAINT "usage_events_user_feature_idem_key" UNIQUE (user_id, feature, idempotency_key);

ALTER TABLE "public"."usage_events"
  ADD CONSTRAINT "usage_events_user_id_feature_idempotency_key_key" UNIQUE (user_id, feature, idempotency_key);

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_email_key" UNIQUE (email);

ALTER TABLE "public"."admin_events"
  ADD CONSTRAINT "admin_events_severity_check" CHECK (severity = ANY (ARRAY['debug'::text, 'info'::text, 'warning'::text, 'error'::text, 'critical'::text]));

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_entitlement_mode_check" CHECK (entitlement_mode = ANY (ARRAY['open'::text, 'dry_run'::text, 'enforced'::text]));

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_free_ai_scan_monthly_limit_positive" CHECK (free_ai_scan_monthly_limit >= 0);

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_free_replacement_pricing_monthly_limit_positive" CHECK (free_replacement_pricing_monthly_limit >= 0);

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_id_check" CHECK (id = 1);

ALTER TABLE "public"."claim_packs"
  ADD CONSTRAINT "claim_packs_country_code_check" CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."claim_packs"
  ADD CONSTRAINT "claim_packs_currency_code_check" CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."claim_packs"
  ADD CONSTRAINT "claim_packs_summary_currency_check" CHECK (summary_currency IS NULL OR summary_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_feature_check" CHECK (feature = ANY (ARRAY['ai_scan'::text, 'replacement_pricing'::text]));

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_limit_units_nonnegative" CHECK (limit_units >= 0);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_month_key_check" CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'::text);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_reserved_units_nonnegative" CHECK (reserved_units >= 0);

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_used_units_nonnegative" CHECK (used_units >= 0);

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_feature_check" CHECK (feature = ANY (ARRAY['ai_scan'::text, 'replacement_pricing'::text]));

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_idempotency_key_not_blank" CHECK (btrim(idempotency_key) <> ''::text);

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_month_key_check" CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'::text);

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'committed'::text, 'refunded'::text, 'expired'::text, 'denied'::text]));

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_units_positive" CHECK (units > 0);

ALTER TABLE "public"."feedback_messages"
  ADD CONSTRAINT "feedback_messages_body_check" CHECK (char_length(btrim(body)) >= 1 AND char_length(btrim(body)) <= 4000);

ALTER TABLE "public"."feedback_messages"
  ADD CONSTRAINT "feedback_messages_sender_role_check" CHECK (sender_role = ANY (ARRAY['user'::text, 'admin'::text, 'system'::text]));

ALTER TABLE "public"."feedback_reports"
  ADD CONSTRAINT "feedback_reports_classification_check" CHECK (classification = ANY (ARRAY['issue'::text, 'bug'::text, 'feature'::text, 'feedback'::text]));

ALTER TABLE "public"."feedback_reports"
  ADD CONSTRAINT "feedback_reports_severity_check" CHECK (severity = ANY (ARRAY['minor'::text, 'moderate'::text, 'high'::text, 'critical'::text])) NOT VALID;

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_country_code_check" CHECK (country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_currency_code_check" CHECK (currency_code ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_property_type_check" CHECK (property_type IS NULL OR (property_type = ANY (ARRAY['main_home'::text, 'rental_property'::text, 'holiday_beach_house'::text, 'storage_unit'::text, 'parents_home'::text, 'business'::text, 'other'::text, 'rental'::text, 'holiday'::text, 'holiday_home'::text, 'storage'::text, 'parents'::text]))) NOT VALID;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_estimated_currency_check" CHECK (estimated_currency IS NULL OR estimated_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_fulfilment_type_check" CHECK (web_listing_fulfilment_type IS NULL OR (web_listing_fulfilment_type = ANY (ARRAY['local'::text, 'overseas'::text, 'unknown'::text])));

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_original_purchase_currency_check" CHECK (original_purchase_currency IS NULL OR original_purchase_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_valuation_market_check" CHECK (valuation_market IS NULL OR valuation_market ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_web_listing_currency_check" CHECK (web_listing_currency IS NULL OR web_listing_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."pricing_markets"
  ADD CONSTRAINT "pricing_markets_country_code_check" CHECK (country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."pricing_markets"
  ADD CONSTRAINT "pricing_markets_currency_code_check" CHECK (currency_code ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."pricing_markets"
  ADD CONSTRAINT "pricing_markets_pricing_support_tier_check" CHECK (pricing_support_tier = ANY (ARRAY['verified'::text, 'preview'::text, 'limited'::text]));

ALTER TABLE "public"."referrals"
  ADD CONSTRAINT "chk_no_self_referral" CHECK (referrer_user_id <> referred_user_id);

ALTER TABLE "public"."revenuecat_webhook_events"
  ADD CONSTRAINT "revenuecat_webhook_events_status_check" CHECK (status = ANY (ARRAY['processing'::text, 'processed'::text, 'ignored'::text, 'failed'::text]));

ALTER TABLE "public"."usage_events"
  ADD CONSTRAINT "usage_events_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'committed'::text, 'refunded'::text]));

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_country_code_format" CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."app_settings"
  ADD CONSTRAINT "app_settings_mode_changed_by_fkey" FOREIGN KEY (mode_changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."claim_evidence"
  ADD CONSTRAINT "claim_evidence_file_id_fkey" FOREIGN KEY (file_id) REFERENCES inventory_files(id) ON DELETE CASCADE;

ALTER TABLE "public"."claim_evidence"
  ADD CONSTRAINT "claim_evidence_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."claim_evidence_items"
  ADD CONSTRAINT "claim_evidence_items_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES claim_evidence(id) ON DELETE CASCADE;

ALTER TABLE "public"."claim_evidence_items"
  ADD CONSTRAINT "claim_evidence_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;

ALTER TABLE "public"."claim_pack_tokens"
  ADD CONSTRAINT "claim_pack_tokens_claim_pack_id_fkey" FOREIGN KEY (claim_pack_id) REFERENCES claim_packs(id) ON DELETE SET NULL;

ALTER TABLE "public"."claim_packs"
  ADD CONSTRAINT "claim_packs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."feature_usage_monthly"
  ADD CONSTRAINT "feature_usage_monthly_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."feature_usage_reservations"
  ADD CONSTRAINT "feature_usage_reservations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."feedback_comments"
  ADD CONSTRAINT "feedback_comments_feedback_id_fkey" FOREIGN KEY (feedback_id) REFERENCES feedback_reports(id) ON DELETE CASCADE;

ALTER TABLE "public"."feedback_messages"
  ADD CONSTRAINT "feedback_messages_sender_user_id_fkey" FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."feedback_messages"
  ADD CONSTRAINT "feedback_messages_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES feedback_reports(id) ON DELETE CASCADE;

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_market_currency_fkey" FOREIGN KEY (country_code, currency_code) REFERENCES pricing_markets(country_code, currency_code);

ALTER TABLE "public"."inventory_files"
  ADD CONSTRAINT "inventory_files_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_file_id_fkey" FOREIGN KEY (file_id) REFERENCES inventory_files(id) ON DELETE CASCADE;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_room_id_fkey" FOREIGN KEY (room_id) REFERENCES inventory_rooms(id) ON DELETE SET NULL;

ALTER TABLE "public"."inventory_rooms"
  ADD CONSTRAINT "inventory_rooms_file_id_fkey" FOREIGN KEY (file_id) REFERENCES inventory_files(id) ON DELETE CASCADE;

ALTER TABLE "public"."referral_rewards"
  ADD CONSTRAINT "referral_rewards_referral_id_fkey" FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE;

ALTER TABLE "public"."revenuecat_webhook_events"
  ADD CONSTRAINT "revenuecat_webhook_events_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."usage_events"
  ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_access_override_granted_by_fkey" FOREIGN KEY (access_override_granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."claim_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."claim_evidence_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."claim_pack_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."claim_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feature_usage_monthly" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feature_usage_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feedback_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feedback_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feedback_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pricing_markets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."referral_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."referral_rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."revenuecat_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scan_detection_performance_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scan_performance_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_audit_action ON public.admin_audit_log USING btree (action);
CREATE INDEX idx_audit_actor ON public.admin_audit_log USING btree (actor_id);
CREATE INDEX idx_audit_created ON public.admin_audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_target ON public.admin_audit_log USING btree (target_user_id);
CREATE INDEX admin_events_created_at_idx ON public.admin_events USING btree (created_at DESC);
CREATE INDEX admin_events_severity_created_at_idx ON public.admin_events USING btree (severity, created_at DESC);
CREATE INDEX idx_claim_evidence_file_id ON public.claim_evidence USING btree (file_id);
CREATE INDEX idx_claim_evidence_user_id ON public.claim_evidence USING btree (user_id);
CREATE INDEX idx_claim_evidence_items_item_id ON public.claim_evidence_items USING btree (item_id);
CREATE INDEX idx_claim_pack_tokens_status ON public.claim_pack_tokens USING btree (status);
CREATE INDEX idx_claim_pack_tokens_stripe_session ON public.claim_pack_tokens USING btree (stripe_session_id);
CREATE INDEX idx_claim_pack_tokens_user_email ON public.claim_pack_tokens USING btree (user_email);
CREATE INDEX idx_claim_pack_tokens_user_id ON public.claim_pack_tokens USING btree (user_id);
CREATE INDEX claim_packs_file_id_created_at_idx ON public.claim_packs USING btree (file_id, created_at DESC);
CREATE INDEX claim_packs_storage_path_idx ON public.claim_packs USING btree (storage_path) WHERE (storage_path IS NOT NULL);
CREATE INDEX claim_packs_user_generated_at_idx ON public.claim_packs USING btree (user_id, generated_at DESC) WHERE (generated_at IS NOT NULL);
CREATE INDEX idx_claim_packs_user_id ON public.claim_packs USING btree (user_id);
CREATE INDEX feature_usage_monthly_user_month_idx ON public.feature_usage_monthly USING btree (user_id, month_key);
CREATE INDEX feature_usage_reservations_expiry_idx ON public.feature_usage_reservations USING btree (expires_at) WHERE (status = 'reserved'::text);
CREATE INDEX feature_usage_reservations_user_month_idx ON public.feature_usage_reservations USING btree (user_id, month_key);
CREATE INDEX feedback_messages_ticket_created_idx ON public.feedback_messages USING btree (ticket_id, created_at);
CREATE INDEX feedback_messages_unread_idx ON public.feedback_messages USING btree (ticket_id, sender_role, created_at);
CREATE INDEX idx_inv_files_user_id ON public.inventory_files USING btree (user_id);
CREATE INDEX idx_inv_items_file_id ON public.inventory_items USING btree (file_id);
CREATE INDEX idx_inventory_items_room_id ON public.inventory_items USING btree (room_id);
CREATE INDEX idx_inventory_rooms_file_id ON public.inventory_rooms USING btree (file_id);
CREATE INDEX idx_inventory_rooms_user_id ON public.inventory_rooms USING btree (user_id);
CREATE INDEX idx_referral_codes_code ON public.referral_codes USING btree (referral_code);
CREATE UNIQUE INDEX idx_referral_codes_user_id ON public.referral_codes USING btree (user_id);
CREATE UNIQUE INDEX idx_referral_rewards_referral_type ON public.referral_rewards USING btree (referral_id, reward_type);
CREATE INDEX idx_referral_rewards_user_id ON public.referral_rewards USING btree (user_id);
CREATE INDEX idx_referrals_referral_code ON public.referrals USING btree (referral_code);
CREATE UNIQUE INDEX idx_referrals_referred_user_id ON public.referrals USING btree (referred_user_id) WHERE (referred_user_id IS NOT NULL);
CREATE INDEX idx_referrals_referrer_user_id ON public.referrals USING btree (referrer_user_id);
CREATE INDEX revenuecat_webhook_events_profile_received_idx ON public.revenuecat_webhook_events USING btree (profile_id, received_at DESC);
CREATE INDEX revenuecat_webhook_events_received_at_idx ON public.revenuecat_webhook_events USING btree (received_at DESC);
CREATE INDEX revenuecat_webhook_events_status_received_idx ON public.revenuecat_webhook_events USING btree (status, received_at DESC);
CREATE INDEX idx_scan_perf_created_at ON public.scan_performance_logs USING btree (created_at DESC);
CREATE INDEX idx_scan_perf_error ON public.scan_performance_logs USING btree (error_stage) WHERE (error_stage IS NOT NULL);
CREATE INDEX idx_scan_perf_file_id ON public.scan_performance_logs USING btree (file_id);
CREATE INDEX idx_scan_perf_slow ON public.scan_performance_logs USING btree (save_total_ms) WHERE (save_total_ms > 10000);
CREATE INDEX idx_scan_perf_user_id ON public.scan_performance_logs USING btree (user_id);
CREATE INDEX idx_usage_dry_run ON public.usage_events USING btree (entitlement_mode) WHERE (entitlement_mode = 'dry_run'::text);
CREATE INDEX idx_usage_user_month ON public.usage_events USING btree (user_id, feature, month_key);
CREATE INDEX idx_up_override_status ON public.user_profiles USING btree (access_override_status) WHERE (access_override_status = 'active'::text);
CREATE INDEX idx_user_profiles_stripe_subscription_id ON public.user_profiles USING btree (stripe_subscription_id);
CREATE UNIQUE INDEX user_profiles_revenuecat_customer_id_unique ON public.user_profiles USING btree (revenuecat_customer_id) WHERE (revenuecat_customer_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.commit_usage(p_feature text, p_idempotency_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN UPDATE usage_events SET status = 'committed', updated_at = NOW() WHERE user_id = auth.uid() AND feature = p_feature AND idempotency_key = p_idempotency_key AND status = 'reserved'; END; $function$;
ALTER FUNCTION public."commit_usage"(p_feature text, p_idempotency_key text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_entitlement_mode()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT entitlement_mode FROM app_settings WHERE id = 1; $function$;
ALTER FUNCTION public."get_entitlement_mode"() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_my_effective_plan()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE v_row public.user_profiles%ROWTYPE; BEGIN SELECT * INTO v_row FROM user_profiles WHERE id = auth.uid(); IF v_row.app_role = 'admin' THEN RETURN 'admin'; END IF; IF v_row.access_override_status = 'active' AND v_row.access_override_plan IS NOT NULL AND (v_row.access_override_expires_at IS NULL OR v_row.access_override_expires_at > NOW()) THEN RETURN v_row.access_override_plan; END IF; IF v_row.subscription_status IN ('active', 'trialing') THEN RETURN COALESCE(v_row.subscription_plan, v_row.plan, 'free'); END IF; IF v_row.subscription_status = 'past_due' AND v_row.subscription_period_end IS NOT NULL AND v_row.subscription_period_end > NOW() - INTERVAL '7 days' THEN RETURN COALESCE(v_row.subscription_plan, v_row.plan, 'free'); END IF; RETURN 'free'; END; $function$;
ALTER FUNCTION public."get_my_effective_plan"() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.refund_usage(p_feature text, p_idempotency_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN UPDATE usage_events SET status = 'refunded', updated_at = NOW() WHERE user_id = auth.uid() AND feature = p_feature AND idempotency_key = p_idempotency_key AND status = 'reserved'; END; $function$;
ALTER FUNCTION public."refund_usage"(p_feature text, p_idempotency_key text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.reserve_usage(p_feature text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE v_user_id UUID := auth.uid(); v_plan TEXT; v_mode TEXT; v_month_key TEXT := TO_CHAR(NOW(), 'YYYY-MM'); v_plan_allows BOOLEAN; v_allowed BOOLEAN; v_would_block BOOLEAN; BEGIN IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF; v_plan := get_my_effective_plan(); v_mode := get_entitlement_mode(); v_plan_allows := CASE p_feature WHEN 'ai_scan' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'price_search' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'voice_enrich' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'barcode_check' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'evidence_upload' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'claim_pack' THEN v_plan IN ('coverly_plus','coverly_family','admin') WHEN 'multi_property' THEN v_plan IN ('coverly_family','admin') ELSE TRUE END; v_would_block := NOT v_plan_allows; v_allowed := CASE v_mode WHEN 'enforced' THEN v_plan_allows ELSE TRUE END; INSERT INTO usage_events (user_id, feature, idempotency_key, status, month_key, effective_plan, entitlement_mode, allowed, would_have_blocked) VALUES (v_user_id, p_feature, p_idempotency_key, 'reserved', v_month_key, v_plan, v_mode, v_allowed, v_would_block) ON CONFLICT (user_id, feature, idempotency_key) DO NOTHING; RETURN jsonb_build_object('allowed', v_allowed, 'would_have_blocked', v_would_block, 'effective_plan', v_plan, 'entitlement_mode', v_mode); END; $function$;
ALTER FUNCTION public."reserve_usage"(p_feature text, p_idempotency_key text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$;
ALTER FUNCTION public."set_updated_at"() OWNER TO postgres;

CREATE TRIGGER trg_feedback_reports_updated_at BEFORE UPDATE ON public."feedback_reports" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inventory_rooms_updated_at BEFORE UPDATE ON public."inventory_rooms" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('claim-evidence', 'claim-evidence', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('claim-packs', 'claim-packs', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inventory-photos', 'inventory-photos', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "admins read audit log" ON "public"."admin_audit_log"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "authenticated read app_settings" ON "public"."app_settings"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "Users manage own evidence" ON "public"."claim_evidence"
  AS PERMISSIVE FOR ALL TO "public"
  USING ((created_by_email = (auth.jwt() ->> 'email'::text)))
  WITH CHECK ((created_by_email = (auth.jwt() ->> 'email'::text)));

CREATE POLICY "evidence_delete_own" ON "public"."claim_evidence"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "evidence_insert_own" ON "public"."claim_evidence"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "evidence_select_own" ON "public"."claim_evidence"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "evidence_update_own" ON "public"."claim_evidence"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users manage own evidence items" ON "public"."claim_evidence_items"
  AS PERMISSIVE FOR ALL TO "public"
  USING ((EXISTS ( SELECT 1
   FROM claim_evidence e
  WHERE ((e.id = claim_evidence_items.evidence_id) AND (e.created_by_email = (auth.jwt() ->> 'email'::text))))));

CREATE POLICY "evitems_delete_own" ON "public"."claim_evidence_items"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((EXISTS ( SELECT 1
   FROM claim_evidence ce
  WHERE ((ce.id = claim_evidence_items.evidence_id) AND (ce.user_id = auth.uid())))));

CREATE POLICY "evitems_insert_own" ON "public"."claim_evidence_items"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM claim_evidence ce
  WHERE ((ce.id = claim_evidence_items.evidence_id) AND (ce.user_id = auth.uid())))));

CREATE POLICY "evitems_select_own" ON "public"."claim_evidence_items"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((EXISTS ( SELECT 1
   FROM claim_evidence ce
  WHERE ((ce.id = claim_evidence_items.evidence_id) AND (ce.user_id = auth.uid())))));

CREATE POLICY "Users manage own tokens" ON "public"."claim_pack_tokens"
  AS PERMISSIVE FOR ALL TO "public"
  USING ((user_email = (auth.jwt() ->> 'email'::text)))
  WITH CHECK ((user_email = (auth.jwt() ->> 'email'::text)));

CREATE POLICY "packs_delete_own" ON "public"."claim_packs"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "packs_insert_own" ON "public"."claim_packs"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "packs_select_own" ON "public"."claim_packs"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "packs_update_own" ON "public"."claim_packs"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "allow_admin_all_feedback_comments" ON "public"."feedback_comments"
  AS PERMISSIVE FOR ALL TO "service_role"
  USING (true);

CREATE POLICY "feedback messages select ticket participant" ON "public"."feedback_messages"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM feedback_reports fr
  WHERE ((fr.id = feedback_messages.ticket_id) AND (fr.user_id = (auth.uid())::text)))) OR (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.app_role = 'admin'::text))))));

CREATE POLICY "allow_admin_select_feedback" ON "public"."feedback_reports"
  AS PERMISSIVE FOR SELECT TO "service_role"
  USING (true);

CREATE POLICY "allow_admin_update_feedback" ON "public"."feedback_reports"
  AS PERMISSIVE FOR UPDATE TO "service_role"
  USING (true);

CREATE POLICY "feedback reports mobile attach screenshot own" ON "public"."feedback_reports"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING (((auth.uid())::text = user_id))
  WITH CHECK ((((auth.uid())::text = user_id) AND ((screenshot_url IS NULL) OR (screenshot_url ~~ ((auth.uid())::text || '/%'::text)))));

CREATE POLICY "feedback reports mobile insert own" ON "public"."feedback_reports"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((((auth.uid())::text = user_id) AND (status = 'new'::text) AND (source = ANY (ARRAY['mobile_app'::text, 'in_app'::text])) AND (feedback_type = ANY (ARRAY['issue'::text, 'feedback'::text, 'enhancement'::text, 'recognition_issue'::text])) AND (severity = ANY (ARRAY['minor'::text, 'moderate'::text, 'high'::text, 'critical'::text])) AND ((screenshot_url IS NULL) OR (screenshot_url ~~ ((auth.uid())::text || '/%'::text)))));

CREATE POLICY "feedback reports mobile select admin" ON "public"."feedback_reports"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.app_role = 'admin'::text)))));

CREATE POLICY "feedback reports mobile select own" ON "public"."feedback_reports"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((auth.uid())::text = user_id));

CREATE POLICY "feedback reports screenshot insert namespace" ON "public"."feedback_reports"
  AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK (((screenshot_url IS NULL) OR (screenshot_url ~~ ((auth.uid())::text || '/%'::text))));

CREATE POLICY "feedback reports screenshot update namespace" ON "public"."feedback_reports"
  AS RESTRICTIVE FOR UPDATE TO "authenticated"
  USING (true)
  WITH CHECK (((screenshot_url IS NULL) OR (screenshot_url ~~ ((auth.uid())::text || '/%'::text))));

CREATE POLICY "files_delete_own" ON "public"."inventory_files"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "files_insert_own" ON "public"."inventory_files"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "files_select_own" ON "public"."inventory_files"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "files_update_own" ON "public"."inventory_files"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "items_delete_own" ON "public"."inventory_items"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_items.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "items_insert_own" ON "public"."inventory_items"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_items.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "items_select_own" ON "public"."inventory_items"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_items.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "items_update_own" ON "public"."inventory_items"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_items.file_id) AND (f.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_items.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "inventory_rooms_delete_own" ON "public"."inventory_rooms"
  AS PERMISSIVE FOR DELETE TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_rooms.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "inventory_rooms_insert_own" ON "public"."inventory_rooms"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_rooms.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "inventory_rooms_select_own" ON "public"."inventory_rooms"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_rooms.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "inventory_rooms_update_own" ON "public"."inventory_rooms"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_rooms.file_id) AND (f.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = inventory_rooms.file_id) AND (f.user_id = auth.uid())))));

CREATE POLICY "Authenticated users can read pricing markets" ON "public"."pricing_markets"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "referral_codes_insert_own" ON "public"."referral_codes"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "referral_codes_select_authenticated" ON "public"."referral_codes"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "referral_codes_update_own" ON "public"."referral_codes"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "referral_rewards_admin_select" ON "public"."referral_rewards"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "referral_rewards_admin_update" ON "public"."referral_rewards"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "referral_rewards_insert_authenticated" ON "public"."referral_rewards"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "referral_rewards_select_own" ON "public"."referral_rewards"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "referral_rewards_update_own" ON "public"."referral_rewards"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "referrals_admin_select" ON "public"."referrals"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "referrals_insert_authenticated" ON "public"."referrals"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "referrals_select_as_referred" ON "public"."referrals"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((auth.uid() = referred_user_id));

CREATE POLICY "referrals_select_as_referrer" ON "public"."referrals"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((auth.uid() = referrer_user_id));

CREATE POLICY "referrals_update_own" ON "public"."referrals"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING (((auth.uid() = referred_user_id) OR (auth.uid() = referrer_user_id)));

CREATE POLICY "scan_det_insert" ON "public"."scan_detection_performance_logs"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "scan_det_select" ON "public"."scan_detection_performance_logs"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "scan_perf_insert" ON "public"."scan_performance_logs"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "scan_perf_insert_policy" ON "public"."scan_performance_logs"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((auth.role() = 'authenticated'::text));

CREATE POLICY "scan_perf_select" ON "public"."scan_performance_logs"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "scan_perf_select_policy" ON "public"."scan_performance_logs"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "admins see all usage" ON "public"."usage_events"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((EXISTS ( SELECT 1
   FROM user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.app_role = 'admin'::text)))));

CREATE POLICY "users see own usage" ON "public"."usage_events"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((user_id = auth.uid()));

CREATE POLICY "profiles_insert_own" ON "public"."user_profiles"
  AS PERMISSIVE FOR INSERT TO "public"
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "profiles_select_own" ON "public"."user_profiles"
  AS PERMISSIVE FOR SELECT TO "public"
  USING ((id = auth.uid()));

CREATE POLICY "profiles_update_own" ON "public"."user_profiles"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "users can insert own profile" ON "public"."user_profiles"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "users can update own profile" ON "public"."user_profiles"
  AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "users can view own profile" ON "public"."user_profiles"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "evidence_files_delete_own" ON "storage"."objects"
  AS PERMISSIVE FOR DELETE TO "public"
  USING (((bucket_id = 'claim-evidence'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "evidence_files_insert_own" ON "storage"."objects"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((bucket_id = 'claim-evidence'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (EXISTS ( SELECT 1
   FROM inventory_files f
  WHERE ((f.id = (storage.foldername(objects.name))[2]) AND (f.user_id = auth.uid()))))));

CREATE POLICY "evidence_files_select_own" ON "storage"."objects"
  AS PERMISSIVE FOR SELECT TO "public"
  USING (((bucket_id = 'claim-evidence'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "feedback screenshots read admin" ON "storage"."objects"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((bucket_id = 'feedback-screenshots'::text) AND (EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.app_role = 'admin'::text))))));

CREATE POLICY "feedback screenshots read own" ON "storage"."objects"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((bucket_id = 'feedback-screenshots'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

CREATE POLICY "feedback screenshots upload own" ON "storage"."objects"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((bucket_id = 'feedback-screenshots'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

CREATE POLICY "packs_files_delete_own" ON "storage"."objects"
  AS PERMISSIVE FOR DELETE TO "public"
  USING (((bucket_id = 'claim-packs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "packs_files_select_own" ON "storage"."objects"
  AS PERMISSIVE FOR SELECT TO "public"
  USING (((bucket_id = 'claim-packs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "photos_delete_own" ON "storage"."objects"
  AS PERMISSIVE FOR DELETE TO "public"
  USING (((bucket_id = 'inventory-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "photos_insert_own" ON "storage"."objects"
  AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((bucket_id = 'inventory-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "photos_select_own" ON "storage"."objects"
  AS PERMISSIVE FOR SELECT TO "public"
  USING (((bucket_id = 'inventory-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "photos_update_own" ON "storage"."objects"
  AS PERMISSIVE FOR UPDATE TO "public"
  USING (((bucket_id = 'inventory-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  WITH CHECK (((bucket_id = 'inventory-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

REVOKE ALL ON TABLE "public"."admin_audit_log" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."admin_audit_log" TO "service_role";
REVOKE ALL ON TABLE "public"."admin_events" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."admin_events" TO "service_role";
REVOKE ALL ON TABLE "public"."app_settings" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."app_settings" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."app_settings" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."app_settings" TO "service_role";
REVOKE ALL ON TABLE "public"."claim_evidence" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence" TO "service_role";
REVOKE ALL ON TABLE "public"."claim_evidence_items" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence_items" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence_items" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_evidence_items" TO "service_role";
REVOKE ALL ON TABLE "public"."claim_pack_tokens" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_pack_tokens" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_pack_tokens" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_pack_tokens" TO "service_role";
REVOKE ALL ON TABLE "public"."claim_packs" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_packs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_packs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."claim_packs" TO "service_role";
REVOKE ALL ON TABLE "public"."feature_usage_monthly" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feature_usage_monthly" TO "service_role";
REVOKE ALL ON TABLE "public"."feature_usage_reservations" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feature_usage_reservations" TO "service_role";
REVOKE ALL ON TABLE "public"."feedback_comments" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_comments" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_comments" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_comments" TO "service_role";
REVOKE ALL ON TABLE "public"."feedback_messages" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."feedback_messages" TO "authenticated";
REVOKE ALL ON TABLE "public"."feedback_reports" FROM anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_reports" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."feedback_reports" TO "service_role";
REVOKE ALL ON TABLE "public"."inventory_files" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_files" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_files" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_files" TO "service_role";
REVOKE ALL ON TABLE "public"."inventory_items" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_items" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_items" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_items" TO "service_role";
REVOKE ALL ON TABLE "public"."inventory_rooms" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_rooms" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_rooms" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."inventory_rooms" TO "service_role";
REVOKE ALL ON TABLE "public"."pricing_markets" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."pricing_markets" TO "service_role";
GRANT SELECT ON TABLE "public"."pricing_markets" TO "authenticated";
REVOKE ALL ON TABLE "public"."referral_codes" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_codes" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_codes" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_codes" TO "service_role";
REVOKE ALL ON TABLE "public"."referral_rewards" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_rewards" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_rewards" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referral_rewards" TO "service_role";
REVOKE ALL ON TABLE "public"."referrals" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referrals" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referrals" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."referrals" TO "service_role";
REVOKE ALL ON TABLE "public"."revenuecat_webhook_events" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."revenuecat_webhook_events" TO "service_role";
REVOKE ALL ON TABLE "public"."scan_detection_performance_logs" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_detection_performance_logs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_detection_performance_logs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_detection_performance_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."scan_performance_logs" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_performance_logs" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_performance_logs" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."scan_performance_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."usage_events" FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."usage_events" TO "anon";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."usage_events" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."usage_events" TO "service_role";
REVOKE ALL ON TABLE "public"."user_profiles" FROM anon, authenticated;
GRANT SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."user_profiles" TO "anon";
GRANT SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."user_profiles" TO "authenticated";
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."user_profiles" TO "service_role";

GRANT ALL ON SEQUENCE "public"."claim_evidence_items_id_seq" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE "public"."claim_evidence_items_id_seq" TO anon, authenticated;
GRANT ALL ON SEQUENCE "public"."claim_pack_tokens_id_seq" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE "public"."claim_pack_tokens_id_seq" TO anon, authenticated;
GRANT ALL ON SEQUENCE "public"."claim_packs_id_seq" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE "public"."claim_packs_id_seq" TO anon, authenticated;
GRANT ALL ON SEQUENCE "public"."inventory_files_file_number_seq" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE "public"."inventory_files_file_number_seq" TO anon, authenticated;

INSERT INTO public.app_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON FUNCTION public."commit_usage"(p_feature text, p_idempotency_key text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."commit_usage"(p_feature text, p_idempotency_key text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public."get_entitlement_mode"() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."get_entitlement_mode"() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public."get_my_effective_plan"() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."get_my_effective_plan"() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public."refund_usage"(p_feature text, p_idempotency_key text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."refund_usage"(p_feature text, p_idempotency_key text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public."reserve_usage"(p_feature text, p_idempotency_key text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."reserve_usage"(p_feature text, p_idempotency_key text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public."set_updated_at"() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO authenticated, service_role;

COMMIT;
