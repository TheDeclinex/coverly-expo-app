-- Align inventory_files.property_type validation with the mobile app's
-- canonical property type values while preserving known legacy values already
-- used by earlier mobile builds.
--
-- This keeps a CHECK constraint in place for new and updated rows. NOT VALID
-- avoids blocking the migration if older production data contains a value that
-- needs separate cleanup.

ALTER TABLE public.inventory_files
  DROP CONSTRAINT IF EXISTS inventory_files_property_type_check;

ALTER TABLE public.inventory_files
  ADD CONSTRAINT inventory_files_property_type_check
  CHECK (
    property_type IS NULL
    OR property_type IN (
      -- canonical mobile values
      'main_home',
      'rental_property',
      'holiday_beach_house',
      'storage_unit',
      'parents_home',
      'business',
      'other',

      -- known legacy mobile values retained for compatibility
      'rental',
      'holiday',
      'holiday_home',
      'storage',
      'parents'
    )
  ) NOT VALID;
