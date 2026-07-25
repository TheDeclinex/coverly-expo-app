-- Delete a user's property and its inventory atomically.
--
-- The previous mobile flow issued three independent DELETE requests. A
-- network or policy failure between them could leave a partially deleted
-- property. This RPC keeps the ownership check and all deletes in one
-- database transaction, so any failure rolls the whole operation back.

CREATE OR REPLACE FUNCTION public.delete_my_inventory_file(p_file_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_owned_file_id text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT id
    INTO v_owned_file_id
  FROM public.inventory_files
  WHERE id = p_file_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_owned_file_id IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.inventory_items
  WHERE file_id = v_owned_file_id;

  DELETE FROM public.inventory_rooms
  WHERE file_id = v_owned_file_id;

  DELETE FROM public.inventory_files
  WHERE id = v_owned_file_id
    AND user_id = v_user_id;
END;
$$;

ALTER FUNCTION public.delete_my_inventory_file(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_my_inventory_file(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_inventory_file(text) TO authenticated;

COMMENT ON FUNCTION public.delete_my_inventory_file(text) IS
  'Atomically deletes the authenticated user''s property, rooms, and items.';
