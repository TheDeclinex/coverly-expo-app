-- Room removal is a soft archive: archived rows remain for item history.
-- Only active rooms reserve a normalized name within a property/file.
DROP INDEX IF EXISTS public.idx_inventory_rooms_file_name_unique;

CREATE UNIQUE INDEX idx_inventory_rooms_file_name_unique
  ON public.inventory_rooms (file_id, lower(btrim(name)))
  WHERE archived_at IS NULL;
