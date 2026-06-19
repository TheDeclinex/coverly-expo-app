# Data Model and Supabase

## Core hierarchy

```text
inventory_files
  inventory_rooms
    inventory_items
```

## Tables

### `inventory_files`

Represents a property / inventory file.

Examples:
- Main home
- Rental property
- Beach house

Important fields may include:
- `id`
- `user_id`
- `name` / property name equivalent
- `property_type`
- `insured_value`
- `cover_image_url` or equivalent
- timestamps

Use the actual schema as source of truth.

### `inventory_rooms`

Represents a room inside a property.

Important fields may include:
- `id`
- `file_id`
- `user_id`
- `name`
- `notes`
- `cover_image_url` or equivalent
- timestamps

Known RLS direction:
- Rooms should be user-owned directly or through parent file ownership.

### `inventory_items`

Represents an item inside a room/property.

Important fields may include:
- `id`
- `file_id`
- `room` or `room_id`, depending on current schema
- `name`
- `description`
- `category`
- `brand_maker`
- `model_series`
- `condition_label`
- `estimatedPrice`
- `quantity_estimate`
- `valuation_basis`
- `image_url`
- `photo_url`
- `pins`
- timestamps

Important current note:
- Do not assume `inventory_items` has `user_id`.
- Current ownership may be inferred through `inventory_files`.

## RLS principles

Client code must respect RLS.

Expected policy principles:
- A user can select files where `inventory_files.user_id = auth.uid()`.
- A user can select rooms they own directly or via parent file.
- A user can select items where the item’s parent file belongs to them.
- Inserts and updates should preserve parent ownership.

## Storage

Primary bucket:

```text
inventory-photos
```

Expected path direction:

```text
{userId}/{fileId}/{timestamp-or-id}.jpg
```

Use whatever path convention the current app already applies unless intentionally changing it.

## Image URL storage rule

Database values should store **storage paths**, not signed URLs.

Good:

```text
user-id/file-id/photo-123.jpg
```

Avoid as permanent DB value:

```text
https://...signed-url...
```

Signed URLs expire and should be generated at display time.

## Migration caution

Before schema changes:
1. Check current schema.
2. Check UI Bakery/web app compatibility.
3. Check Edge Functions.
4. Check RLS.
5. Write migration SQL.
6. Document rollback risk.
