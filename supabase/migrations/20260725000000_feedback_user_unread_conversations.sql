-- Count unread feedback conversations for users, and keep admin-generated
-- support activity aligned with per-ticket unread indicators.
-- Create-only in this change: do not apply automatically.

BEGIN;

-- Older status events were written as system messages without updating the
-- ticket's last admin activity timestamp. Backfill that summary field so the
-- ticket list and global unread count agree.
WITH latest_admin_activity AS (
  SELECT
    ticket_id,
    max(created_at) AS last_admin_activity_at
  FROM public.feedback_messages
  WHERE sender_role IN ('admin', 'system')
  GROUP BY ticket_id
)
UPDATE public.feedback_reports fr
SET last_admin_message_at = latest_admin_activity.last_admin_activity_at
FROM latest_admin_activity
WHERE fr.id = latest_admin_activity.ticket_id
  AND (
    fr.last_admin_message_at IS NULL
    OR fr.last_admin_message_at < latest_admin_activity.last_admin_activity_at
  );

-- The original one-argument RPC always preferred the admin branch. Add a
-- role-aware overload for the new client while retaining the old signature
-- for backwards compatibility with already-shipped app versions.
CREATE OR REPLACE FUNCTION public.feedback_mark_ticket_read(
  p_ticket_id uuid,
  p_viewer_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_id text;
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_viewer_role NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'invalid feedback viewer role: %', p_viewer_role USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO v_owner_id
  FROM public.feedback_reports
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ticket not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_viewer_role = 'user' THEN
    IF v_owner_id <> auth.uid()::text THEN
      RAISE EXCEPTION 'feedback ticket access denied' USING ERRCODE = '42501';
    END IF;

    UPDATE public.feedback_reports
    SET user_last_read_at = now()
    WHERE id = p_ticket_id;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.app_role = 'admin'
  ) INTO v_is_admin;

  IF p_viewer_role = 'admin' AND v_is_admin THEN
    UPDATE public.feedback_reports
    SET admin_last_read_at = now()
    WHERE id = p_ticket_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'feedback ticket access denied' USING ERRCODE = '42501';
END;
$function$;

ALTER FUNCTION public.feedback_mark_ticket_read(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.feedback_mark_ticket_read(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_mark_ticket_read(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_feedback_unread_counts()
RETURNS TABLE (
  user_unread_count bigint,
  admin_unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (
      SELECT count(DISTINCT fm.ticket_id)
      FROM public.feedback_messages fm
      JOIN public.feedback_reports fr ON fr.id = fm.ticket_id
      WHERE fr.user_id = auth.uid()::text
        AND fm.sender_role IN ('admin', 'system')
        AND fm.created_at > COALESCE(fr.user_last_read_at, '-infinity'::timestamptz)
    ) AS user_unread_count,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.app_role = 'admin'
      )
      THEN (
        SELECT count(DISTINCT fm.ticket_id)
        FROM public.feedback_messages fm
        JOIN public.feedback_reports fr ON fr.id = fm.ticket_id
        WHERE fm.sender_role = 'user'
          AND fm.created_at > COALESCE(fr.admin_last_read_at, '-infinity'::timestamptz)
      )
      ELSE 0
    END AS admin_unread_count;
$function$;

ALTER FUNCTION public.get_feedback_unread_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_feedback_unread_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feedback_unread_counts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_feedback_status(
  p_feedback_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_status text;
  v_now timestamptz := now();
  v_event text;
BEGIN
  PERFORM public.assert_current_user_admin();

  IF p_status NOT IN (
    'new',
    'under_investigation',
    'development',
    'testing',
    'resolved',
    'closed'
  ) THEN
    RAISE EXCEPTION 'invalid feedback status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT status
  INTO v_previous_status
  FROM public.feedback_reports
  WHERE id = p_feedback_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ticket not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_previous_status IS NOT DISTINCT FROM p_status THEN
    RETURN;
  END IF;

  v_event := 'Status changed to ' || CASE p_status
    WHEN 'under_investigation' THEN 'Under investigation'
    WHEN 'development' THEN 'Development'
    WHEN 'testing' THEN 'Testing'
    WHEN 'resolved' THEN 'Resolved'
    WHEN 'closed' THEN 'Closed'
    ELSE 'New'
  END;

  UPDATE public.feedback_reports
  SET status = p_status,
      updated_at = v_now,
      last_activity_at = v_now,
      admin_last_read_at = v_now,
      last_admin_message_at = v_now,
      latest_message_preview = left(v_event, 180)
  WHERE id = p_feedback_id;

  INSERT INTO public.feedback_messages (
    ticket_id,
    sender_user_id,
    sender_role,
    body,
    created_at
  )
  VALUES (
    p_feedback_id,
    auth.uid(),
    'system',
    v_event,
    v_now
  );
END;
$function$;

ALTER FUNCTION public.admin_update_feedback_status(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_feedback_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_feedback_status(uuid, text) TO authenticated, service_role;

COMMIT;
