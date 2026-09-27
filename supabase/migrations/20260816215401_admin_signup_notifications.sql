-- Minimal internal queue for registered-admin new-account push notifications.
-- Delivery is intentionally asynchronous: auth.users only writes a queue row.

BEGIN;

CREATE TABLE public.admin_notification_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Standard PostgreSQL strings preserve backslashes: use one per bracket.
  CHECK (expo_push_token ~ '^(Expo(nent)?PushToken)\[[A-Za-z0-9_-]+\]$')
);

CREATE INDEX admin_notification_devices_admin_user_id_idx
  ON public.admin_notification_devices(admin_user_id);

CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('new_user')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  expo_ticket_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX admin_notifications_status_created_at_idx
  ON public.admin_notifications(status, created_at);

ALTER TABLE public.admin_notification_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- These are internal tables. No client policies are created, and explicit
-- grants are revoked as defense in depth if public remains Data API-exposed.
REVOKE ALL ON TABLE public.admin_notification_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_notification_devices TO service_role;
GRANT ALL ON TABLE public.admin_notifications TO service_role;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_new_user_admin_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    INSERT INTO public.admin_notifications(type, user_id, email)
    VALUES ('new_user', NEW.id, NEW.email);
  EXCEPTION WHEN OTHERS THEN
    -- Notification bookkeeping must never prevent creation of an auth user.
    RAISE WARNING 'Could not enqueue new-user admin notification (SQLSTATE %)', SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.enqueue_new_user_admin_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enqueue_new_user_admin_notification() FROM PUBLIC, anon, authenticated;

-- A distinct name avoids replacing or changing any other auth.users trigger.
CREATE TRIGGER on_auth_user_created_enqueue_admin_notification
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.enqueue_new_user_admin_notification();

COMMIT;

-- Verification (run after applying in a non-production test project):
-- 1. Create a disposable Auth user and confirm one pending new_user row exists.
-- 2. SET LOCAL ROLE authenticated; SELECT * FROM public.admin_notifications;
--    should fail with permission denied.
-- 3. Confirm signup still succeeds if the queue insert is deliberately made to
--    fail in a disposable local database (the trigger emits only a warning).
