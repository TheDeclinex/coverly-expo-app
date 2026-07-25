-- Match Coverly's production billing enforcement mode on reconstructed
-- environments. This is application configuration, not customer data.

BEGIN;

INSERT INTO public.app_settings (
  id,
  entitlement_mode,
  mode_changed_by,
  mode_changed_at,
  mode_change_reason
)
VALUES (
  1,
  'enforced',
  NULL,
  now(),
  'Source-controlled environment provisioning default'
)
ON CONFLICT (id) DO UPDATE SET
  entitlement_mode = EXCLUDED.entitlement_mode,
  mode_changed_by = EXCLUDED.mode_changed_by,
  mode_changed_at = EXCLUDED.mode_changed_at,
  mode_change_reason = EXCLUDED.mode_change_reason;

COMMIT;
