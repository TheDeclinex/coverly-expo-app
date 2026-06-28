-- Mobile Feedback & Support V1: reuse existing UI Bakery feedback tables.
--
-- Production already has:
--   public.feedback_reports
--   public.feedback_comments
--
-- This migration deliberately does NOT create or recreate feedback_reports.
-- It only adds the private screenshot bucket and narrowly scoped access needed
-- for mobile screenshots, while preserving UI Bakery compatibility.
--
-- Expected existing feedback_reports columns used by mobile:
--   source, status, feedback_type, severity, title, description,
--   expected_result, wants_followup, screenshot_url, user_id, user_email,
--   screen_name, route, environment, app_version, device_info, os_info,
--   browser_info, metadata_json, created_at, updated_at.

BEGIN;

-- Required for mobile screenshot attachments. The screenshot_url column stores
-- a private storage path, not a public URL or permanent signed URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- Keep grants narrow. RLS controls rows; column grants prevent mobile users
-- from mutating/admin-seeding UI Bakery admin fields through PostgREST.
REVOKE ALL ON TABLE public.feedback_reports FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback_reports FROM authenticated;

DO $$
DECLARE
  v_column text;
  v_admin_columns text[] := ARRAY[
    'status',
    'assigned_to',
    'root_cause_category',
    'github_issue_number',
    'github_issue_url',
    'resolved_at',
    'closed_at',
    'admin_notes'
  ];
BEGIN
  FOREACH v_column IN ARRAY v_admin_columns LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'feedback_reports'
        AND column_name = v_column
    ) THEN
      EXECUTE format('REVOKE SELECT (%I) ON TABLE public.feedback_reports FROM authenticated', v_column);
      EXECUTE format('REVOKE INSERT (%I) ON TABLE public.feedback_reports FROM authenticated', v_column);
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.feedback_reports FROM authenticated', v_column);
    END IF;
  END LOOP;
END $$;

GRANT SELECT (
  id,
  created_at,
  updated_at,
  source,
  status,
  feedback_type,
  severity,
  title,
  description,
  expected_result,
  wants_followup,
  screenshot_url,
  user_id,
  user_email,
  user_name,
  screen_name,
  route,
  environment,
  app_version,
  property_id,
  file_id,
  room_id,
  item_id,
  scan_session_id,
  item_title,
  detected_category,
  detected_brand,
  barcode,
  matched_listing_id,
  browser_info,
  device_info,
  os_info,
  metadata_json
) ON TABLE public.feedback_reports TO authenticated;

GRANT INSERT (
  id,
  created_at,
  updated_at,
  source,
  status,
  feedback_type,
  severity,
  title,
  description,
  expected_result,
  wants_followup,
  screenshot_url,
  user_id,
  user_email,
  user_name,
  screen_name,
  route,
  environment,
  app_version,
  property_id,
  file_id,
  room_id,
  item_id,
  scan_session_id,
  item_title,
  detected_category,
  detected_brand,
  barcode,
  matched_listing_id,
  browser_info,
  device_info,
  os_info,
  metadata_json
) ON TABLE public.feedback_reports TO authenticated;

GRANT UPDATE (screenshot_url, updated_at) ON TABLE public.feedback_reports TO authenticated;

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

-- Production currently has allow_insert_feedback WITH CHECK true for
-- authenticated users. RLS policies are OR-combined, so leaving that policy in
-- place would bypass the stricter mobile insert policy below.
DROP POLICY IF EXISTS allow_insert_feedback ON public.feedback_reports;

-- Existing UI Bakery feedback_reports.user_id is text, while auth.uid()
-- returns uuid. Cast auth.uid() to text for feedback_reports ownership checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_reports'
      AND policyname = 'feedback reports mobile insert own'
  ) THEN
    CREATE POLICY "feedback reports mobile insert own"
      ON public.feedback_reports
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid()::text = user_id
        AND status = 'new'
        AND source IN ('mobile_app', 'in_app')
        AND feedback_type IN ('issue', 'feedback', 'enhancement', 'recognition_issue')
        AND severity IN ('minor', 'moderate', 'critical')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_reports'
      AND policyname = 'feedback reports mobile select own'
  ) THEN
    CREATE POLICY "feedback reports mobile select own"
      ON public.feedback_reports
      FOR SELECT
      TO authenticated
      USING (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_reports'
      AND policyname = 'feedback reports mobile select admin'
  ) THEN
    CREATE POLICY "feedback reports mobile select admin"
      ON public.feedback_reports
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_profiles up
          WHERE up.id = auth.uid()
            AND up.app_role = 'admin'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_reports'
      AND policyname = 'feedback reports mobile attach screenshot own'
  ) THEN
    CREATE POLICY "feedback reports mobile attach screenshot own"
      ON public.feedback_reports
      FOR UPDATE
      TO authenticated
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'feedback screenshots upload own'
  ) THEN
    CREATE POLICY "feedback screenshots upload own"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'feedback-screenshots'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'feedback screenshots read own'
  ) THEN
    CREATE POLICY "feedback screenshots read own"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'feedback-screenshots'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'feedback screenshots read admin'
  ) THEN
    CREATE POLICY "feedback screenshots read admin"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'feedback-screenshots'
        AND EXISTS (
          SELECT 1
          FROM public.user_profiles up
          WHERE up.id = auth.uid()
            AND up.app_role = 'admin'
        )
      );
  END IF;

END $$;

CREATE OR REPLACE FUNCTION public.admin_update_feedback_status(
  p_feedback_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();

  IF p_status NOT IN (
    'new',
    'under_investigation',
    'bug',
    'development',
    'testing',
    'feature',
    'resolved',
    'closed'
  ) THEN
    RAISE EXCEPTION 'invalid feedback status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.feedback_reports
  SET status = p_status,
      updated_at = now()
  WHERE id = p_feedback_id;
END;
$function$;

ALTER FUNCTION public.admin_update_feedback_status(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_feedback_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_feedback_status(uuid, text) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- PRE-APPLY PRODUCTION AUDIT QUERIES
-- ============================================================
-- SELECT table_schema, table_name, table_type
-- FROM information_schema.tables
-- WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
--   AND (
--     table_name ILIKE '%feedback%'
--     OR table_name ILIKE '%support%'
--     OR table_name ILIKE '%bug%'
--     OR table_name ILIKE '%issue%'
--     OR table_name ILIKE '%enhancement%'
--   )
-- ORDER BY table_schema, table_name;
--
-- SELECT table_schema, table_name, ordinal_position, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('feedback_reports', 'feedback_comments')
-- ORDER BY table_name, ordinal_position;
--
-- SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE (schemaname = 'public' AND tablename IN ('feedback_reports', 'feedback_comments'))
--    OR (schemaname = 'storage' AND tablename = 'objects')
-- ORDER BY schemaname, tablename, policyname;
--
-- SELECT table_schema, table_name, grantee, privilege_type
-- FROM information_schema.table_privileges
-- WHERE table_schema = 'public'
--   AND table_name IN ('feedback_reports', 'feedback_comments')
-- ORDER BY table_name, grantee, privilege_type;
--
-- SELECT id, name, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets
-- WHERE id ILIKE '%feedback%'
--    OR id ILIKE '%support%'
--    OR id ILIKE '%screenshot%'
--    OR id ILIKE '%attachment%'
-- ORDER BY id;
