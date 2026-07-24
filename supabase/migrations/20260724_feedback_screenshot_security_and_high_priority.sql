-- Restrict feedback screenshot writes to stable user-owned storage paths and
-- add the complete feedback priority vocabulary.

BEGIN;

-- Preserve legacy rows while enforcing the complete priority vocabulary for
-- every new or updated row. Existing values remain unchanged.
ALTER TABLE public.feedback_reports
  DROP CONSTRAINT IF EXISTS feedback_reports_severity_check;

ALTER TABLE public.feedback_reports
  ADD CONSTRAINT feedback_reports_severity_check
  CHECK (severity IN ('minor', 'moderate', 'high', 'critical'))
  NOT VALID;

-- Re-assert ticket ownership and the complete priority set for user inserts.
-- screenshot_url is normally NULL on insert and populated only after upload.
DROP POLICY IF EXISTS allow_insert_feedback ON public.feedback_reports;
DROP POLICY IF EXISTS "feedback reports mobile insert own" ON public.feedback_reports;
CREATE POLICY "feedback reports mobile insert own"
  ON public.feedback_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid()::text = user_id
    AND status = 'new'
    AND source IN ('mobile_app', 'in_app')
    AND feedback_type IN ('issue', 'feedback', 'enhancement', 'recognition_issue')
    AND severity IN ('minor', 'moderate', 'high', 'critical')
    AND (
      screenshot_url IS NULL
      OR screenshot_url LIKE auth.uid()::text || '/%'
    )
  );

DROP POLICY IF EXISTS "feedback reports mobile attach screenshot own" ON public.feedback_reports;
CREATE POLICY "feedback reports mobile attach screenshot own"
  ON public.feedback_reports
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (
    auth.uid()::text = user_id
    AND (
      screenshot_url IS NULL
      OR screenshot_url LIKE auth.uid()::text || '/%'
    )
  );

-- Restrictive policies preserve the trust boundary even if a separate
-- permissive legacy policy exists. They affect writes only, so existing
-- external screenshot URLs remain readable.
DROP POLICY IF EXISTS "feedback reports screenshot insert namespace" ON public.feedback_reports;
CREATE POLICY "feedback reports screenshot insert namespace"
  ON public.feedback_reports
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    screenshot_url IS NULL
    OR screenshot_url LIKE auth.uid()::text || '/%'
  );

DROP POLICY IF EXISTS "feedback reports screenshot update namespace" ON public.feedback_reports;
CREATE POLICY "feedback reports screenshot update namespace"
  ON public.feedback_reports
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    screenshot_url IS NULL
    OR screenshot_url LIKE auth.uid()::text || '/%'
  );

CREATE OR REPLACE FUNCTION public.admin_update_feedback_priority(
  p_feedback_id uuid,
  p_priority text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_severity text;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF p_priority NOT IN ('blocking', 'high', 'normal', 'low') THEN
    RAISE EXCEPTION 'invalid feedback priority: %', p_priority USING ERRCODE = '22023';
  END IF;

  v_severity := CASE p_priority
    WHEN 'blocking' THEN 'critical'
    WHEN 'high' THEN 'high'
    WHEN 'low' THEN 'minor'
    ELSE 'moderate'
  END;

  UPDATE public.feedback_reports
  SET severity = v_severity,
      metadata_json = jsonb_set(
        COALESCE(metadata_json, '{}'::jsonb),
        '{priority}',
        to_jsonb(p_priority),
        true
      ),
      updated_at = now()
  WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ticket not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

ALTER FUNCTION public.admin_update_feedback_priority(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_feedback_priority(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_feedback_priority(uuid, text) TO authenticated, service_role;

COMMIT;
