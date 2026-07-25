-- REVIEW ONLY: do not apply until explicitly approved.
-- Covers profile mutation grants, admin RPC authorization, ownership, and RPC grants.

BEGIN;

-- Prevent direct profile creation/mutation through PostgREST roles. Existing
-- SECURITY DEFINER backend/admin functions continue to execute as their owner.
REVOKE INSERT, UPDATE ON TABLE public.user_profiles FROM anon, authenticated;

REVOKE INSERT (
  id, email, full_name, plan, app_role, onboarding_status, created_at, updated_at,
  access_override_plan, access_override_status, access_override_reason,
  access_override_expires_at, access_override_granted_by,
  access_override_created_at, subscription_plan, subscription_period_end,
  subscription_status, stripe_customer_id, stripe_subscription_id
) ON public.user_profiles FROM anon, authenticated;

REVOKE UPDATE (
  id, email, full_name, plan, app_role, onboarding_status, created_at, updated_at,
  access_override_plan, access_override_status, access_override_reason,
  access_override_expires_at, access_override_granted_by,
  access_override_created_at, subscription_plan, subscription_period_end,
  subscription_status, stripe_customer_id, stripe_subscription_id
) ON public.user_profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_current_user_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.app_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_user_profile(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller_id uuid := auth.uid(); v_target_id uuid;
BEGIN
  PERFORM public.assert_current_user_admin();
  SELECT id INTO v_target_id FROM public.user_profiles WHERE lower(email) = lower(p_email);
  IF v_target_id IS NULL THEN RAISE EXCEPTION 'user not found: %', p_email; END IF;
  IF v_target_id = v_caller_id THEN RAISE EXCEPTION 'cannot delete your own profile'; END IF;
  DELETE FROM public.user_profiles WHERE id = v_target_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_app_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row public.app_settings%ROWTYPE; v_email text;
BEGIN
  PERFORM public.assert_current_user_admin();
  SELECT * INTO v_row FROM public.app_settings WHERE id = 1;
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_row.mode_changed_by;
  RETURN jsonb_build_object(
    'entitlement_mode', v_row.entitlement_mode,
    'mode_changed_by_email', v_email,
    'mode_changed_at', v_row.mode_changed_at,
    'mode_change_reason', v_row.mode_change_reason
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_dry_run_log()
RETURNS TABLE(id uuid, user_email text, feature text, effective_plan text,
  would_have_blocked boolean, allowed boolean, entitlement_mode text,
  month_key text, status text, created_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY SELECT ue.id, up.email, ue.feature, ue.effective_plan,
    ue.would_have_blocked, ue.allowed, ue.entitlement_mode, ue.month_key,
    ue.status, ue.created_at
  FROM public.usage_events ue
  LEFT JOIN public.user_profiles up ON up.id = ue.user_id
  WHERE ue.entitlement_mode = 'dry_run'
  ORDER BY ue.created_at DESC LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_files()
RETURNS TABLE(id text, name text, status text, created_date timestamp with time zone,
  last_modified timestamp with time zone, file_number bigint, created_by_email text,
  item_count integer, total_value numeric, photo_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY SELECT f.id, f.name, f.status, f.created_date, f.last_modified,
    f.file_number, f.created_by_email, count(i.id)::integer,
    coalesce(sum(i.estimated_price), 0)::numeric, count(i.photo_url)::integer
  FROM public.inventory_files f
  LEFT JOIN public.inventory_items i ON i.file_id = f.id
  GROUP BY f.id, f.name, f.status, f.created_date, f.last_modified,
    f.file_number, f.created_by_email
  ORDER BY f.last_modified DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_items()
RETURNS TABLE(id text, file_id text, name text, category text, confidence numeric,
  estimated_price numeric, source_link text, image_url text, photo_url text,
  notes text, room text, scan_date timestamp with time zone, image_pin jsonb,
  attachments jsonb, visibility_status text, description text, barcode text,
  barcode_verified boolean, sort_order integer, voice_verified boolean,
  file_name text, owner_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY SELECT i.id, i.file_id, i.name, i.category, i.confidence,
    i.estimated_price, i.source_link, i.image_url, i.photo_url, i.notes, i.room,
    i.scan_date, i.image_pin, i.attachments, i.visibility_status, i.description,
    i.barcode, i.barcode_verified, i.sort_order, i.voice_verified,
    f.name, f.created_by_email
  FROM public.inventory_items i
  JOIN public.inventory_files f ON f.id = i.file_id
  ORDER BY f.last_modified DESC, i.scan_date DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_override_history(p_target_email text)
RETURNS TABLE(id uuid, action text, details jsonb, created_at timestamp with time zone,
  actor_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_target_id uuid;
BEGIN
  PERFORM public.assert_current_user_admin();
  SELECT up.id INTO v_target_id FROM public.user_profiles up
    WHERE lower(up.email) = lower(p_target_email);
  RETURN QUERY SELECT l.id, l.action, l.details, l.created_at, up.email
  FROM public.admin_audit_log l
  LEFT JOIN public.user_profiles up ON up.id = l.actor_id
  WHERE l.target_user_id = v_target_id
    AND l.action IN ('override_granted', 'override_revoked')
  ORDER BY l.created_at DESC LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_stats()
RETURNS TABLE(total_users integer, total_files integer, total_items integer,
  total_value numeric, verified_items integer, items_with_photos integer,
  new_files_30d integer, new_users_30d integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY SELECT
    (SELECT count(*)::integer FROM public.user_profiles WHERE email IS NOT NULL),
    (SELECT count(*)::integer FROM public.inventory_files),
    (SELECT count(*)::integer FROM public.inventory_items),
    (SELECT coalesce(sum(estimated_price), 0)::numeric FROM public.inventory_items),
    (SELECT count(*)::integer FROM public.inventory_items WHERE barcode_verified = true),
    (SELECT count(*)::integer FROM public.inventory_items WHERE photo_url IS NOT NULL),
    (SELECT count(*)::integer FROM public.inventory_files WHERE created_date >= now() - interval '30 days'),
    (SELECT count(*)::integer FROM public.user_profiles WHERE created_at >= now() - interval '30 days' AND email IS NOT NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_load_user_profiles()
RETURNS TABLE(id text, email text, display_name text, tier text,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  is_implicit boolean, is_admin boolean, subscription_status text,
  subscription_plan text, subscription_period_end timestamp with time zone,
  stripe_customer_id text, access_override_plan text, access_override_status text,
  access_override_reason text, access_override_expires_at timestamp with time zone,
  access_override_created_at timestamp with time zone,
  access_override_granted_by_email text, override_is_live boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY SELECT up.id::text, up.email, up.full_name, up.plan,
    up.created_at, up.updated_at, false::boolean, (up.app_role = 'admin')::boolean,
    up.subscription_status, up.subscription_plan, up.subscription_period_end,
    up.stripe_customer_id, up.access_override_plan, up.access_override_status,
    up.access_override_reason, up.access_override_expires_at,
    up.access_override_created_at, granter.email,
    (up.access_override_status = 'active' AND up.access_override_plan IS NOT NULL
      AND (up.access_override_expires_at IS NULL OR up.access_override_expires_at > now()))::boolean
  FROM public.user_profiles up
  LEFT JOIN public.user_profiles granter ON granter.id = up.access_override_granted_by
  ORDER BY up.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_diagnostics_settings(
  p_save_performance boolean, p_scan_detection boolean, p_verbose_console boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  UPDATE public.app_settings SET
    diagnostics_save_performance_enabled = p_save_performance,
    diagnostics_scan_detection_enabled = p_scan_detection,
    diagnostics_verbose_console_enabled = p_verbose_console
  WHERE id = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_entitlement_mode(p_mode text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller_id uuid := auth.uid(); v_prev_mode text;
BEGIN
  PERFORM public.assert_current_user_admin();
  IF p_mode NOT IN ('open', 'dry_run', 'enforced') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;
  SELECT entitlement_mode INTO v_prev_mode FROM public.app_settings WHERE id = 1;
  IF v_prev_mode = p_mode THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'mode', p_mode);
  END IF;
  UPDATE public.app_settings SET entitlement_mode = p_mode,
    mode_changed_by = v_caller_id, mode_changed_at = now(), mode_change_reason = p_reason
  WHERE id = 1;
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, details)
  VALUES (v_caller_id, 'entitlement_mode_changed', NULL,
    jsonb_build_object('previous_mode', v_prev_mode, 'new_mode', p_mode, 'reason', p_reason));
  RETURN jsonb_build_object('success', true, 'changed', true,
    'previous_mode', v_prev_mode, 'new_mode', p_mode);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_override(p_target_email text,
  p_override_plan text, p_override_status text, p_reason text,
  p_expires_at timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller_id uuid := auth.uid(); v_target_id uuid;
BEGIN
  PERFORM public.assert_current_user_admin();
  IF p_override_status NOT IN ('active', 'revoked') THEN
    RAISE EXCEPTION 'invalid status: %', p_override_status;
  END IF;
  IF p_override_status = 'active' THEN
    IF p_override_plan NOT IN ('coverly_plus', 'coverly_family') THEN
      RAISE EXCEPTION 'invalid plan: %', p_override_plan;
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
      RAISE EXCEPTION 'expiry must be in the future';
    END IF;
  END IF;
  SELECT id INTO v_target_id FROM public.user_profiles
    WHERE lower(email) = lower(p_target_email);
  IF v_target_id IS NULL THEN RAISE EXCEPTION 'user not found: %', p_target_email; END IF;
  IF v_target_id = v_caller_id THEN RAISE EXCEPTION 'cannot override yourself'; END IF;
  UPDATE public.user_profiles SET
    access_override_plan = CASE WHEN p_override_status = 'revoked' THEN NULL ELSE p_override_plan END,
    access_override_status = p_override_status,
    access_override_reason = p_reason,
    access_override_expires_at = CASE WHEN p_override_status = 'revoked' THEN NULL ELSE p_expires_at END,
    access_override_granted_by = v_caller_id,
    access_override_created_at = now(), updated_at = now()
  WHERE id = v_target_id;
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, details)
  VALUES (v_caller_id,
    CASE WHEN p_override_status = 'revoked' THEN 'override_revoked' ELSE 'override_granted' END,
    v_target_id, jsonb_build_object('plan', p_override_plan,
      'status', p_override_status, 'reason', p_reason,
      'expires_at', p_expires_at, 'target', p_target_email));
  RETURN jsonb_build_object('success', true, 'target', p_target_email);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_email text, p_is_admin boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller_id uuid := auth.uid(); v_target_id uuid;
BEGIN
  PERFORM public.assert_current_user_admin();
  SELECT id INTO v_target_id FROM public.user_profiles WHERE lower(email) = lower(p_email);
  IF v_target_id IS NULL THEN RAISE EXCEPTION 'user not found: %', p_email; END IF;
  IF v_target_id = v_caller_id AND NOT p_is_admin THEN
    RAISE EXCEPTION 'cannot remove your own admin role';
  END IF;
  UPDATE public.user_profiles SET
    app_role = CASE WHEN p_is_admin THEN 'admin' ELSE 'user' END,
    updated_at = now() WHERE id = v_target_id;
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, details)
  VALUES (v_caller_id,
    CASE WHEN p_is_admin THEN 'admin_granted' ELSE 'admin_revoked' END,
    v_target_id, jsonb_build_object('email', p_email));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_user_profile(p_email text,
  p_display_name text, p_plan text, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_current_user_admin();
  IF p_plan NOT IN ('free', 'coverly_plus', 'coverly_family') THEN
    RAISE EXCEPTION 'invalid plan: %', p_plan;
  END IF;
  INSERT INTO public.user_profiles(email, full_name, plan, updated_at)
  VALUES (p_email, p_display_name, p_plan, now())
  ON CONFLICT (email) DO UPDATE SET full_name = excluded.full_name,
    plan = excluded.plan, updated_at = now();
END;
$function$;

-- Normalize ownership so SECURITY DEFINER RPCs execute as the same trusted
-- owner that owns the non-public helper. Existing exports show postgres grants;
-- these statements make the dependency explicit rather than relying on session owner.
ALTER FUNCTION public.assert_current_user_admin() OWNER TO postgres;
ALTER FUNCTION public.admin_delete_user_profile(text) OWNER TO postgres;
ALTER FUNCTION public.admin_load_app_settings() OWNER TO postgres;
ALTER FUNCTION public.admin_load_dry_run_log() OWNER TO postgres;
ALTER FUNCTION public.admin_load_files() OWNER TO postgres;
ALTER FUNCTION public.admin_load_items() OWNER TO postgres;
ALTER FUNCTION public.admin_load_override_history(text) OWNER TO postgres;
ALTER FUNCTION public.admin_load_stats() OWNER TO postgres;
ALTER FUNCTION public.admin_load_user_profiles() OWNER TO postgres;
ALTER FUNCTION public.admin_set_diagnostics_settings(boolean, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.admin_set_entitlement_mode(text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_set_override(text, text, text, text, timestamp with time zone) OWNER TO postgres;
ALTER FUNCTION public.admin_set_user_role(text, boolean) OWNER TO postgres;
ALTER FUNCTION public.admin_upsert_user_profile(text, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_current_user_admin()
  FROM PUBLIC, anon, authenticated, service_role;

-- Admin RPCs are callable only by authenticated sessions and service-role
-- backend code; their internal assertion distinguishes admins from customers.
REVOKE EXECUTE ON FUNCTION public.admin_delete_user_profile(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_app_settings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_dry_run_log() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_files() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_items() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_override_history(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_load_user_profiles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_diagnostics_settings(boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_entitlement_mode(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_override(text, text, text, text, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_user_profile(text, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_delete_user_profile(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_app_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_dry_run_log() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_files() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_items() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_override_history(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_user_profiles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_diagnostics_settings(boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_entitlement_mode(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_override(text, text, text, text, timestamp with time zone) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_user_profile(text, text, text, text) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- POST-APPLY VERIFICATION (run separately; do not include in transaction above)
-- ============================================================
-- SELECT p.proname,
--   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname LIKE 'admin_%'
-- ORDER BY p.proname;
-- Expected: anon=false and authenticated=true for each admin RPC.
--
-- SELECT has_table_privilege('authenticated', 'public.user_profiles', 'INSERT') AS can_insert,
--   has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') AS can_update;
-- Expected: both false.
--
-- SELECT p.proname, pg_get_userbyid(p.proowner) AS owner
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND (p.proname = 'assert_current_user_admin' OR p.proname LIKE 'admin_%')
-- ORDER BY p.proname;
-- Expected: postgres for the helper and every patched admin RPC.
--
-- Test each expected failure in its own transaction because permission errors
-- abort the current transaction:
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub',
--   '00000000-0000-0000-0000-000000000001', true);
-- SELECT * FROM public.admin_load_stats(); -- expected permission denied
-- ROLLBACK;
--
-- Repeat with an existing customer UUID (expected denied), then the admin UUID
-- for read-only admin_load_stats/files/user_profiles calls (expected success).
