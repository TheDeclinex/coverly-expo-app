-- Feedback conversations, native build context, classifications, and read state.
-- Keeps public.feedback_reports as the ticket source of truth used by UI Bakery.

BEGIN;

ALTER TABLE public.feedback_reports
  ADD COLUMN IF NOT EXISTS app_build_number text,
  ADD COLUMN IF NOT EXISTS device_model text,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_user_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_admin_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_message_preview text;

UPDATE public.feedback_reports
SET classification = CASE
      WHEN status = 'bug' THEN 'bug'
      WHEN status = 'feature' THEN 'feature'
      WHEN feedback_type = 'enhancement' THEN 'feature'
      WHEN feedback_type = 'feedback' THEN 'feedback'
      ELSE 'issue'
    END,
    last_activity_at = COALESCE(last_activity_at, updated_at, created_at, now())
WHERE classification IS NULL
   OR last_activity_at IS NULL;

-- Older admin tooling mixed classification values into lifecycle status.
UPDATE public.feedback_reports
SET status = CASE
      WHEN status = 'bug' THEN 'under_investigation'
      WHEN status = 'feature' THEN 'new'
      ELSE status
    END,
    updated_at = now()
WHERE status IN ('bug', 'feature');

ALTER TABLE public.feedback_reports
  DROP CONSTRAINT IF EXISTS feedback_reports_classification_check;

ALTER TABLE public.feedback_reports
  ADD CONSTRAINT feedback_reports_classification_check
  CHECK (classification IN ('issue', 'bug', 'feature', 'feedback'));

CREATE OR REPLACE FUNCTION public.set_feedback_report_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.classification := COALESCE(
    NEW.classification,
    CASE
      WHEN NEW.feedback_type = 'enhancement' THEN 'feature'
      WHEN NEW.feedback_type = 'feedback' THEN 'feedback'
      ELSE 'issue'
    END
  );
  NEW.last_activity_at := COALESCE(NEW.last_activity_at, NEW.updated_at, NEW.created_at, now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_feedback_report_defaults_trigger ON public.feedback_reports;
CREATE TRIGGER set_feedback_report_defaults_trigger
BEFORE INSERT ON public.feedback_reports
FOR EACH ROW
EXECUTE FUNCTION public.set_feedback_report_defaults();

GRANT SELECT (
  app_build_number,
  device_model,
  classification,
  last_activity_at,
  user_last_read_at,
  admin_last_read_at,
  last_user_message_at,
  last_admin_message_at,
  latest_message_preview
) ON TABLE public.feedback_reports TO authenticated;

GRANT INSERT (
  app_build_number,
  device_model,
  classification,
  last_activity_at,
  user_last_read_at,
  latest_message_preview
) ON TABLE public.feedback_reports TO authenticated;

CREATE TABLE IF NOT EXISTS public.feedback_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.feedback_reports(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  sender_role text NOT NULL CHECK (sender_role IN ('user', 'admin', 'system')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  attachment_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS feedback_messages_ticket_created_idx
  ON public.feedback_messages(ticket_id, created_at);

CREATE INDEX IF NOT EXISTS feedback_messages_unread_idx
  ON public.feedback_messages(ticket_id, sender_role, created_at);

ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feedback_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.feedback_messages TO authenticated;

DROP POLICY IF EXISTS "feedback messages select ticket participant" ON public.feedback_messages;
CREATE POLICY "feedback messages select ticket participant"
  ON public.feedback_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.feedback_reports fr
      WHERE fr.id = feedback_messages.ticket_id
        AND fr.user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.app_role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.feedback_add_message(
  p_ticket_id uuid,
  p_body text
)
RETURNS public.feedback_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.feedback_reports%ROWTYPE;
  v_is_admin boolean;
  v_role text;
  v_message public.feedback_messages%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'message must contain between 1 and 4000 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.app_role = 'admin'
  ) INTO v_is_admin;

  SELECT *
  INTO v_ticket
  FROM public.feedback_reports
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ticket not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_admin AND v_ticket.user_id <> auth.uid()::text THEN
    RAISE EXCEPTION 'feedback ticket access denied' USING ERRCODE = '42501';
  END IF;

  IF v_ticket.status = 'closed' THEN
    RAISE EXCEPTION 'closed feedback tickets are read-only' USING ERRCODE = '55000';
  END IF;

  v_role := CASE WHEN v_is_admin THEN 'admin' ELSE 'user' END;

  INSERT INTO public.feedback_messages (
    ticket_id,
    sender_user_id,
    sender_role,
    body,
    created_at
  )
  VALUES (
    p_ticket_id,
    auth.uid(),
    v_role,
    v_body,
    v_now
  )
  RETURNING * INTO v_message;

  UPDATE public.feedback_reports
  SET last_activity_at = v_now,
      updated_at = v_now,
      latest_message_preview = left(v_body, 180),
      user_last_read_at = CASE WHEN v_role = 'user' THEN v_now ELSE user_last_read_at END,
      admin_last_read_at = CASE WHEN v_role = 'admin' THEN v_now ELSE admin_last_read_at END,
      last_user_message_at = CASE WHEN v_role = 'user' THEN v_now ELSE last_user_message_at END,
      last_admin_message_at = CASE WHEN v_role = 'admin' THEN v_now ELSE last_admin_message_at END
  WHERE id = p_ticket_id;

  RETURN v_message;
END;
$function$;

ALTER FUNCTION public.feedback_add_message(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.feedback_add_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_add_message(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.feedback_mark_ticket_read(
  p_ticket_id uuid
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

  SELECT user_id
  INTO v_owner_id
  FROM public.feedback_reports
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback ticket not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.app_role = 'admin'
  ) INTO v_is_admin;

  IF v_is_admin THEN
    UPDATE public.feedback_reports
    SET admin_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSIF v_owner_id = auth.uid()::text THEN
    UPDATE public.feedback_reports
    SET user_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSE
    RAISE EXCEPTION 'feedback ticket access denied' USING ERRCODE = '42501';
  END IF;
END;
$function$;

ALTER FUNCTION public.feedback_mark_ticket_read(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.feedback_mark_ticket_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_mark_ticket_read(uuid) TO authenticated, service_role;

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
      SELECT count(*)
      FROM public.feedback_messages fm
      JOIN public.feedback_reports fr ON fr.id = fm.ticket_id
      WHERE fr.user_id = auth.uid()::text
        AND fm.sender_role = 'admin'
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
        SELECT count(*)
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
      admin_last_read_at = v_now
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
