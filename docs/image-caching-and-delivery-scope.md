# Image caching and delivery optimisation scope

- Status: Phase 1 implemented locally; physical-device measurement pending
- Date: 2026-07-25
- Implementation status: caching-only Phase 1 complete; no Phase 2 or Phase 3 work

## Phase 1 implementation result

The approved caching-only phase now:

- identifies private native image-cache entries by version, account, bucket,
  durable storage path, and the canonical `original` representation;
- reuses signed URLs through per-object React Query entries rather than
  screen-specific sets;
- keeps `expo-image` memory/disk caching and the existing signed original as
  the display and full-screen fallback;
- prefetches only the next image while the full-screen viewer is open;
- clears native memory/disk image caches and signed-image query state at
  logout or account change;
- applies the same path-aware behavior to image evidence while leaving PDFs,
  evidence storage/deletion, and claim generation unchanged.

Repository baseline before implementation: seven signed-remote image surfaces,
zero durable `expo-image` cache identities on those surfaces, and zero
inventory/evidence prefetch call sites. Physical-device network bytes and cache
hit rates remain deliberately unclaimed until iOS and Android traces are
captured.

Local verification after implementation:

- mobile TypeScript check passes;
- 28 focused cache, viewer, pin, room-cover, and scan-image tests pass;
- no package/lockfile, database, Supabase function, upload, or claim-pack files
  changed.

Phase 2 remains gated. Stay on Phase 1 until cold/warm/relaunch traces on
physical iOS and Android devices show whether first-load original-image bytes
remain large enough to justify derivatives.

## Executive recommendation

Coverly should proceed with a caching-only Phase 1 before adding thumbnails or changing the upload pipeline.

The app already uses `expo-image` and generally requests `memory-disk` caching. The main Phase 1 problem is not the absence of a native image cache; it is that the cache is normally identified by a one-hour signed URL. The same Supabase Storage object can receive a different URL after app restart, signed-URL refresh, or resolution in another screen's batch query. Since no durable `cacheKey` is supplied, those URL changes can turn one logical image into multiple cache entries and repeat full-object downloads.

Phase 1 should:

1. Keep Supabase paths and current image objects unchanged.
2. Introduce one path-aware resolved-image model for private inventory and evidence images.
3. Give `expo-image` a stable, account-scoped cache key based on bucket, storage path, representation, and version—not the signed token.
4. Share signed URLs per object path rather than per screen-specific set of paths.
5. Keep `memory-disk` caching and add conservative, measured prefetching.
6. Clear in-memory image/query state and, subject to product approval, the native disk image cache on logout or account change.
7. Preserve the current signed original as the unconditional fallback.
8. Measure cold and warm behaviour before considering derivatives.

This phase is compatible with Supabase Free, needs no new dependency, and should materially reduce repeat egress. It will not reduce the first download of an original-sized image. If cold-list bytes remain material after Phase 1, Phase 2 should add best-effort stored display derivatives alongside—not instead of—the original.

## Scope and constraints

This document covers:

- property cover images;
- room cover images;
- item primary images and item attachments;
- scan source images reused as saved item images;
- evidence and receipt/document images;
- shared image viewers;
- claim-pack image use;
- local device caching, prefetching, invalidation, and privacy;
- stored derivatives and Supabase transformations as later options.

Phase 1 must not change:

- database schema;
- canonical database image fields;
- the `inventory-photos` or `claim-evidence` storage structure;
- existing stored objects;
- upload processing or picker settings;
- RLS or image ownership;
- claim-pack generation;
- evidence upload/deletion behaviour;
- the full-quality source used by claims.

The required failure mode is:

> cache, prefetch, or display optimisation unavailable → resolve and display the existing remote original

## Investigation method and limitations

The findings below come from the repository, including:

- `artifacts/mobile/package.json`;
- `artifacts/mobile/lib/storage-helpers.ts`;
- `artifacts/mobile/hooks/useSignedUrls.ts`;
- `artifacts/mobile/lib/photo-upload.ts`;
- `artifacts/mobile/lib/evidence-service.ts`;
- `artifacts/mobile/lib/scan-service.ts`;
- `artifacts/mobile/app/(tabs)/scan.tsx`;
- `artifacts/mobile/components/ReliableImage.tsx`;
- `artifacts/mobile/components/ExpandableImage.tsx`;
- `artifacts/mobile/components/ImageViewerModal.tsx`;
- the property, room, item, dashboard, and attention screens;
- `supabase/functions/scan-room-photo/index.ts`;
- `supabase/functions/generate-claim-pack/index.ts`.

No production Supabase project, usage dashboard, physical-device network trace, or representative user inventory was available during this investigation. Statements about repeat downloads are therefore code-path predictions that Phase 0/1 measurement must confirm. The repository also cannot prove which Supabase plan the deployed project currently uses.

## Current state

### Dependencies and image components

The mobile app already includes:

- `expo-image` `~3.0.11`;
- `expo-image-picker` `~17.0.9`;
- `expo-image-manipulator` `~14.0.8`;
- `expo-file-system` `~19.0.23`;
- React Query for in-memory request/query caching.

Most remote user imagery is rendered through one of these shared components:

- `ReliableImage`: wraps `expo-image`, retries failed loads, and defaults to `cachePolicy="memory-disk"`;
- `ExpandableImage`: renders through `expo-image`, adds pins, and opens the shared viewer;
- `ImageViewerModal`: renders full-screen pages through `ReliableImage`.

Direct `expo-image` usage also exists for non-inventory imagery such as replacement listings and feedback screenshots. Static authentication assets are prefetched with React Native's `Image.prefetch`, but there is no inventory-image prefetch system.

### Authoritative storage and persisted references

New inventory uploads follow the intended durable-reference model:

```text
local picker/manipulator URI
  → upload to private `inventory-photos`
  → receive storage object path
  → store path in database
  → create a one-hour signed URL for display
```

The current canonical fields are:

| Image family | Bucket | Database reference |
|---|---|---|
| Property cover | `inventory-photos` | `inventory_files.property_cover_image_url` |
| Room cover | `inventory-photos` | `inventory_rooms.cover_photo_url` |
| Item primary | `inventory-photos` | `inventory_items.image_url`, with `photo_url` as legacy/fallback |
| Additional item photos | `inventory-photos` | `inventory_items.attachments[].url` |
| Evidence/receipt/document | `claim-evidence` | `claim_evidence.file_url` |

New inventory paths have the form:

```text
{userId}/{fileId}/{scan|cover|item}-{timestamp}-{random}.{extension}
```

New evidence paths have the form:

```text
{userId}/{fileId}/{evidenceId}.{extension}
```

Unique, non-upserted object names are important: an image replacement normally changes the storage path, which naturally gives the replacement a new logical cache identity.

Legacy full HTTP(S) values are still passed through unchanged. If a historical row contains an expired signed URL rather than a storage path, the current recovery helper cannot re-sign it because it no longer has the durable path.

### Upload and image-quality behaviour

The current upload helper reads the selected local file and uploads that file without another resize or compression step. However, the selected local file may already have been recompressed, cropped, or converted by the picker/manipulator:

| Flow | Current preparation before upload |
|---|---|
| Manual item add | Image picker/camera `quality: 0.8`; no explicit pixel resize |
| Item maintenance/additional photos | `quality: 0.8`; no explicit pixel resize |
| Property cover | `quality: 0.85`, user crop enabled at 16:9; no explicit pixel resize |
| Room cover | `quality: 0.85`, user crop enabled at 16:9; no explicit pixel resize |
| Evidence image | `quality: 0.85`; no explicit pixel resize |
| Scan library still | converted to JPEG at compression `0.8`; dimensions normally retained |
| Scan camera still | picker `quality: 0.8`; dimensions normally retained |
| Scan compatibility mode | longest edge limited to 1600 px and JPEG compression `0.72` |

Consequences:

- Coverly does not currently retain the byte-for-byte camera/library source in every flow.
- It generally retains the full pixel dimensions of the picker result, except cropped covers and compatibility-prepared scan images.
- Phase 1 leaves all of this unchanged.
- Before any later promise to preserve the “original,” product needs to define whether that means the current canonical Supabase object or the untouched device source. Preserving untouched device sources would be a separate upload-policy change, not a caching change.

### Scan-created images

Scan images are uploaded to `inventory-photos` before the Edge Function is invoked. The Edge Function receives storage paths and signs them for OpenAI rather than sending large base64 payloads.

The mobile scan upload helper has a per-session successful-upload cache. The scan-review save path uses the same dedupe key, so a scan source already uploaded for analysis is reused when items are saved. In a multi-item room scan, multiple detected items can correctly reference the same scan source object. This avoids uploading the same scan source once per detected item.

The scan upload cache is cleared when the scan flow is reset. An abandoned or failed storage-first scan can leave an unreferenced Storage object; that is a storage-cleanup concern, not the main repeated-navigation egress cause.

### Signed URL resolution

`getSignedDisplayUrl`:

- returns local and legacy HTTP(S) URIs unchanged;
- creates a one-hour signed URL for a storage path;
- retries signing failures;
- issues a development-only `HEAD` request to verify the object.

`useSignedUrl` caches one result under:

```text
["signed-url", path]
```

`useSignedUrls` caches a whole set under:

```text
["signed-urls", sorted-set-of-paths]
```

Both are stale after 55 minutes and garbage-collected after 60 minutes. React Query itself is not persisted across app restarts.

Important repository-specific effect: the batch cache is scoped to the entire set, not to each object. If the same item image appears in a room batch, an item-detail batch, and a dashboard-search batch, each distinct set can independently call `createSignedUrl` for the same storage path. The helper parallelises individual signing operations; it does not use a single Supabase batch-signing request.

### Existing native caching

`ReliableImage` and `ExpandableImage` normally use:

```tsx
cachePolicy="memory-disk"
source={{ uri: signedUrl }}
```

This means memory and disk caching already exist. The local installed `expo-image` type definition confirms that when `source.cacheKey` is absent, `uri` is used as the cache key.

No user-image call site currently supplies `source.cacheKey`.

The retry wrappers also use:

```text
recyclingKey = signed URL + retry attempt
cachePolicy = "none" after the first failure
```

That is a reasonable recovery mechanism, but a transient failure can intentionally bypass cache on retry and make another network request.

### Current display sizes versus transferred source

Representative rendered sizes include:

- dashboard global search: 54 × 54 points;
- property room thumbnail: 72 × 72 points;
- room detail item thumbnail: 76 × 76 points;
- item edit photo strip: 130 × 100 points;
- dashboard property card: full width × 140 points;
- property and room heroes: full width × approximately 200 points;
- item detail hero: full width × 280 points;
- full-screen viewer: device-sized, `contain`.

All remote contexts currently request the same canonical object. There are no thumbnail or display derivatives and no Supabase transform options. A 54-point search thumbnail can therefore download the same 2–5 MB object used by the full-screen viewer.

### Viewer behaviour

The shared viewer:

- accepts resolved URL strings;
- uses `contain`;
- supports horizontal paging;
- keeps pin alignment and optional pin editing;
- shows a loading indicator and fallback;
- does not accept separate display and original sources;
- does not progressively upgrade from a cached display image to an original;
- does not prefetch adjacent viewer pages.

Today list, detail, and full-screen views all use the same original object. This is bandwidth-heavy, but it means a successfully cached list image can make expansion immediate when the signed URL/cache entry still matches.

### Evidence and documents

Evidence files are stored in the private `claim-evidence` bucket using durable paths. Evidence lists show metadata and icons, not image thumbnails. Opening an evidence image:

1. directly creates a signed URL;
2. opens the shared image viewer;
3. lets `ReliableImage` cache by that signed URL.

There is no React Query/path-level evidence URL cache. Reopening the same evidence image can generate a new token and therefore a new URL-based native cache entry. PDFs open in the browser and are outside the raster image-cache recommendation.

Evidence deletion removes the Storage object when the evidence is no longer shared. This differs from inventory image replacement/deletion, where the inspected client flows update/delete database references but do not remove the corresponding `inventory-photos` objects.

### Claims

Claim-pack generation runs in `generate-claim-pack` and deliberately uses canonical item and evidence references:

- item image priority is `image_url`, then `photo_url`, then the first attachment;
- the function creates signed URLs and fetches original item/evidence bytes server-side;
- the original images are embedded in the generated PDF;
- PDF evidence files are loaded directly from `claim-evidence`.

Device caching does not affect claim-pack source selection. Phase 1 can and should leave this function untouched. In any derivative phase, canonical DB fields must continue pointing to originals so claims keep using source-quality assets.

### Authentication and account changes

The app uses one process-wide React Query client. Most data query keys include the user ID, but signed-image keys do not explicitly include it. Storage paths normally begin with the user ID, which reduces collision risk, but signed URL results and native disk cache entries are not cleared on normal logout.

The tab layout removes admin queries on account changes; it does not clear all user queries or image caches. Therefore:

- another account should not normally receive the first account's rows because inventory queries are user-scoped and RLS-protected;
- cached image bytes can remain in the app sandbox after logout;
- a robust Phase 1 should explicitly treat the authenticated account as part of cache scope and clear sensitive in-memory state at an auth boundary;
- whether to clear all native disk image cache on logout is a product privacy/performance decision because `expo-image` exposes global clearing, not a documented selective eviction API.

## Identified inefficiencies and root causes

### Primary causes

1. **Rotating signed URLs are the native cache key.** A refreshed URL, an app restart, or a second screen-level resolver can produce a cache miss for unchanged bytes.

2. **Batch signed-URL queries are set-scoped rather than object-scoped.** The same path in different screen sets can be signed and cached more than once.

3. **Original-sized objects are used everywhere.** Small cards and thumbnails can transfer multi-megabyte picker outputs.

4. **There is no inventory/evidence prefetch policy.** Likely next images or adjacent viewer pages are not deliberately warmed.

5. **The viewer has no progressive display/original model.** This becomes important once derivatives exist.

6. **Evidence signs on each open outside the shared query cache.** Reopens can miss the URL-keyed native cache.

### Secondary concerns

- The retry path disables caching after an error, which can repeat a GET.
- No cache telemetry currently records `expo-image`'s `cacheType` (`none`, `disk`, or `memory`).
- Inventory image replacement/deletion does not remove old Storage objects in the inspected flows. This increases Storage usage and leaves remote orphans, although it is not required to solve Phase 1 egress.
- Deleted/replaced images can remain in native disk cache until eviction or a global clear. They are no longer referenced by UI data, but the bytes remain in the app sandbox.
- Development-only signed URL `HEAD` checks add requests during development; they do not run in production.
- The OpenAI scan and claim-pack Edge Functions intentionally fetch originals for their jobs. Device caching cannot remove that server-side transfer.

## Recommended architecture

### Logical source model

Introduce an additive internal model such as:

```ts
type CoverlyImageSource = {
  uri: string;
  cacheKey: string;
  storagePath?: string;
  bucket?: "inventory-photos" | "claim-evidence";
  representation: "original" | "card" | "display";
  accountId?: string;
};
```

The exact type name is not a production naming decision; it illustrates the required data.

For a current storage-path original, use a cache identity conceptually like:

```text
coverly-image:v1:{accountId}:{bucket}:{storagePath}:original
```

For future derivatives:

```text
coverly-image:v1:{accountId}:{bucket}:{originalPath}:card-768-q85
coverly-image:v1:{accountId}:{bucket}:{originalPath}:display-1600-q87
```

Rules:

- signed token and expiry must not be part of logical identity;
- account and bucket must be part of identity;
- representation parameters must be part of identity;
- immutable unique storage paths provide invalidation for current uploads;
- legacy HTTP(S) records should fall back to a URL-derived key unless a safe storage path can be recovered;
- local URIs remain local and do not need long-lived private cache identity;
- if same-path overwrite is ever introduced, the cache key must include a version/nonce or last-modified value.

### Phase 1 delivery path

```text
canonical private Supabase path
  → shared per-path signed URL resolver
  → expo-image source { uri: signedUrl, cacheKey: durable account/path key }
  → memory/disk cache
  → UI
  → signed original fallback on any optimisation miss/failure
```

The signed URL remains the authorised transport URL. The durable cache key only tells the app that successive authorised URLs refer to the same immutable object.

### Later derivative delivery path

```text
canonical Supabase original
  ├─ card/display derivative (best effort)
  │    → stable representation-specific device cache
  │    → card/list/detail UI
  └─ original
       → stable original device cache
       → full-screen final image and claims
```

Resolution order:

```text
requested derivative exists?
  yes → display derivative
  no  → display original

full-screen opened?
  cached original exists → show original immediately
  otherwise → show cached display image immediately,
              fetch original,
              crossfade to original when decoded
```

No derivative path may replace the original in `image_url`, `photo_url`, `property_cover_image_url`, `cover_photo_url`, attachments, or evidence fields.

## Image size and quality recommendations

Pixel dimensions must be based on rendered points multiplied by device pixel ratio, with headroom for crop and layout variation. The values below favour premium sharpness over minimum bytes.

| Context | Typical UI size | Recommended delivered target | JPEG quality guidance | Approximate bytes |
|---|---:|---:|---:|---:|
| Small item/room/search cards | 54–130 pt | 512 px long edge; 640 px if heavily cropped | 82–86 | 50–180 KB |
| Larger list/grid/property cards | roughly 140–220 pt | 768 px long edge | 84–87 | 100–300 KB |
| Item/property/room detail hero | up to roughly 430 pt wide | 1440–1600 px long edge | 86–89 | 220–650 KB |
| Full-screen viewer | device size and zoom | canonical original, no intentional quality reduction | existing original | commonly 1–8+ MB |

Ranges depend heavily on scene complexity. Textured room photos can exceed them; simple product shots can be smaller.

For stored derivatives, two tiers are preferable to four separate stored files:

- `card`: 768 px long edge, quality approximately 85;
- `display`: 1600 px long edge, quality approximately 87;
- `original`: unchanged.

The 768 px card tier is deliberately generous for a 3× screen and can serve both 72-point thumbnails and larger grids. A separate 512 px tier should only be added if measured inventory scale justifies its storage and operational cost.

Avoid generating only tiny 200–300 px thumbnails. They can look soft under 3× density, crop zoom, and accessibility/layout changes.

## Caching strategy

### Memory and disk

Continue using the already-installed `expo-image`.

Reasons:

- it already provides memory and disk cache;
- it exposes a custom source `cacheKey`;
- it reports cache source in load events;
- it supports crossfade transitions;
- it exposes prefetch and cache-clear APIs;
- no new native dependency or development-build requirement is introduced.

Do not build a second authoritative file store in `expo-file-system` for Phase 1. A custom file cache would add index management, quotas, cleanup, encryption/privacy decisions, and more failure modes.

### Signed URL cache

Refactor signed URL caching so a storage object has one account/bucket/path query identity:

```text
["signed-image", accountId, bucket, storagePath]
```

Batch hooks may still accept arrays for ergonomics, but each element should reuse the per-path query result. A screen-specific sorted set should not be the only cache owner.

Keep refresh before expiry. A fresh transport URL must continue using the same durable native cache key for an unchanged object.

### Prefetch

Phase 1 prefetching should be conservative:

- prefetch only after above-the-fold content and interactions settle;
- prioritise the next few visible list items, not an entire large inventory;
- when a viewer opens, prefetch the adjacent one or two pages;
- on item press/touch-down, optionally warm the selected original;
- skip or sharply limit prefetch on constrained/cellular conditions if reliable connection state is available;
- cap concurrent image prefetches;
- cancel or ignore work after account change.

The installed `expo-image` version accepts URL strings in `Image.prefetch`, while its prefetch options do not expose a custom cache key. Before relying on it with custom render keys, an implementation spike must verify that prefetched bytes are reused by `{ uri, cacheKey }` rendering on both iOS and Android. If not, use same-session URL-key prefetch only where the viewer renders the same URL, or use a source-aware memory preload. Do not ship duplicate prefetch and render downloads.

### Progressive viewer

Phase 1 does not need separate image resolutions, because the list and viewer currently use the same original. Expansion should benefit automatically from a stable cache identity.

Build the shared source/viewer API so Phase 2 can accept:

- `previewSource`;
- `originalSource`;
- a stable viewer index;
- a short crossfade when original load completes.

Do not add visual complexity until a derivative source actually exists.

### Invalidation

| Event | Expected behaviour |
|---|---|
| Normal navigation | Same path/representation hits memory, then disk; a new signed URL does not force a new body download |
| App restart | React Query signs again, but unchanged objects can hit native disk using stable cache key |
| Logout | Clear signed-image queries and memory image cache; recommended privacy default is also clear disk image cache |
| Account switching | Treat as logout + login cache boundary; never reuse account A's logical keys for B |
| Image replacement | Current unique new storage path produces a new key; old bytes become disposable cache data |
| Same-path overwrite | Unsupported by current `upsert: false`; if introduced, require cache version/nonce |
| Item moved between rooms | Path and account do not change, so cached image remains valid |
| Item/room deletion | UI references disappear; cached bytes may remain until eviction/logout unless a safe targeted eviction mechanism is proven |
| Evidence deletion | Remote object is deleted by current service; viewer reference disappears; local bytes remain disposable until eviction/logout |
| App reinstall | OS removes app cache; remote fallback repopulates it |
| Low storage / OS eviction | Cache miss signs and downloads current original/derivative; functionality continues |
| Large inventory | Only viewed/near-visible images should populate cache; never prefetch every original |

### Privacy

Inventory and evidence images can reveal household contents, addresses, receipts, and serial/product information. The cache is private app-sandbox data, but it is still sensitive.

Recommended privacy policy:

- account ID in every logical private-image cache key;
- clear signed image query data and memory cache whenever auth user changes;
- clear native disk image cache on explicit logout/account switch unless product deliberately chooses faster same-account relogin over local-data minimisation;
- never log paths, signed URLs, cache keys containing raw paths, or image content;
- rely on normal platform backup/exclusion behaviour only after verifying the native cache directory is excluded from cloud backup;
- do not promise immediate forensic erasure for ordinary item deletion unless selective native eviction is implemented and verified.

If global disk clearing on logout is rejected, document that encrypted/sandboxed cached bytes may remain until OS eviction and assess that position in the privacy policy.

## Alternatives

### Option A — client caching only

| Dimension | Assessment |
|---|---|
| Supabase egress | Strong reduction in repeat downloads; no reduction in first original download |
| Supabase storage | No change |
| Device storage | Can be high because originals are cached; OS/native cache remains disposable |
| Complexity | Low–medium |
| Runtime performance | Warm navigation and restart improve; cold decoding/scroll still handles originals |
| Image quality | Unchanged |
| Supabase Free | Fully compatible |
| Operations | Low; no backend or migration |
| Backward compatibility | High; historical storage paths and originals continue |
| Regression risk | Low–medium |

This is the recommended Phase 1.

### Option B — stored high-quality derivatives

Generate best-effort `card` and `display` objects during a future upload while always retaining and committing the original. Derivative names should be deterministically derived from the original path so no schema change is required. Historical images with no derivative fall back to original.

| Dimension | Assessment |
|---|---|
| Supabase egress | Strong cold and warm-byte reduction for cards/heroes |
| Supabase storage | Increases; commonly about 0.3–1.0 MB for two derivatives per original |
| Device storage | Lower for normal browsing; originals cached only when expanded/needed |
| Complexity | Medium |
| Runtime performance | Much better cold lists; upload does extra processing/work |
| Image quality | High with recommended dimensions; original remains final |
| Supabase Free | Compatible if generated client-side and stored normally |
| Operations | More objects, cleanup, partial-upload handling, and policy verification |
| Backward compatibility | High only with derivative-missing → original fallback |
| Regression risk | Medium |

Preferred generation approach if Phase 2 is justified:

1. Upload/confirm the original first.
2. Generate derivatives client-side using the already-installed image manipulator.
3. Upload derivatives best-effort to deterministic sidecar paths.
4. Commit the original database path regardless of derivative failure.
5. Never block image save solely because a derivative failed.
6. Add deletion/replacement cleanup only after exact ownership and shared-reference behaviour is verified.

Client generation adds CPU and upload time, especially for multi-photo scans. It must be sequential/capped and measured on lower-end Android. Server-side custom Edge Function generation is operationally heavier and subject to image-processing CPU/memory constraints, so it is not the preferred first derivative implementation.

### Option C — Supabase server-side transformations

Supabase supports signed URL transform options for private images. As of this document, hosted Storage image resizing is enabled on Pro and above, not Free. Current billing documentation lists 100 transformed origin images included on Pro and then package pricing; Smart CDN is also a Pro-and-above feature.

References:

- [Storage image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Image transformation usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)
- [Supabase billing quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Smart CDN and signed URLs](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

| Dimension | Assessment |
|---|---|
| Supabase egress | Strong cold-byte reduction |
| Supabase storage | No user-managed derivative objects |
| Device storage | Lower for card/display browsing |
| Complexity | Low–medium client code, but plan/config/cost dependency |
| Runtime performance | Good; first transform can add latency |
| Image quality | Configurable and appropriate |
| Supabase Free | Not available |
| Operations | Usage monitoring, transform enablement, spend/quota awareness |
| Backward compatibility | Good with transform failure → original fallback |
| Regression risk | Medium because availability is plan/config dependent |

This is not recommended while avoiding Pro. If Coverly later upgrades for broader reasons, server transforms may be preferable to maintaining stored derivatives.

### Rejected for Phase 1

- **Public inventory bucket:** improves cacheability but weakens the intended private ownership/security model. High risk; do not use.
- **Stable authenticated object URL plus JWT header:** removes signed-token URL churn but introduces token refresh, header-cache, RLS, and native-library behaviour risks. Medium–high risk; unnecessary when custom cache keys solve the main issue.
- **Custom authoritative device file store:** duplicates `expo-image` functionality and creates a local database/cleanup/security system. Medium–high risk.
- **Replacing originals with compressed uploads:** conflicts with the quality/source-of-truth requirement. High risk.
- **Mandatory derivative backfill:** increases migration and operational risk. Historical fallback is safer.

## Expected results

### Phase 1: caching alone

Example: one room contains 20 unique 3 MB originals.

Current cold transfer if all are displayed:

```text
20 × 3 MB = 60 MB
```

Phase 1 first cold display remains approximately 60 MB. Its value is subsequent use:

```text
first authorised download: 60 MB
repeat room/item/viewer navigation with warm cache: approximately 0 MB image bodies
```

If URL churn currently causes the same room to be downloaded three times across screens/restart, the theoretical reduction is from 180 MB to 60 MB, or 67%. For a single 5 MB image used in card, detail, and viewer contexts, stable identity can reduce 15 MB to 5 MB.

Because `expo-image` already caches identical URLs, not every present-day revisit downloads again. A responsible expectation is:

- 50–90% fewer repeat image body GETs across different screens, signed URL refreshes, and warm app restarts;
- 80–99% fewer repeat image bytes after the first successful load for unchanged images;
- perhaps 20–60% lower overall Storage egress in warm-navigation-heavy usage;
- near-immediate warm room and item images from memory/disk;
- improved perceived item expansion when the original was already shown in a card;
- limited improvement to first-ever room load and cold scrolling, because originals are still large.

These ranges must be replaced by measured values. Phase 1 could materially solve the user's stated repeated-egress problem even though it cannot solve cold-list overfetching.

### Phase 2: caching plus derivatives

For the same 20-image room, using a 200 KB card representation:

```text
20 × 200 KB = 4 MB cold list transfer
versus
20 × 3 MB = 60 MB cold list transfer
```

That is approximately a 93% cold-list byte reduction. If the user expands two images:

```text
4 MB card set + 2 × 3 MB originals = 10 MB
```

The list appears from cached/display images; only explicitly expanded originals pay the multi-megabyte cost.

Expected additional Phase 2 benefit:

- 80–95% lower cold list/grid bytes;
- substantially smoother cold scrolling and less decode memory pressure;
- faster above-the-fold display on mobile networks;
- immediate viewer preview plus progressive original upgrade;
- extra Storage use for derivatives;
- no reduction in claim/source quality.

### Supabase and device usage

Current published hosted-plan quotas list 5 GB egress and 1 GB Storage on Free, versus 250 GB egress and 100 GB Storage on Pro/Team. This makes both egress and derivative storage relevant on Free.

Illustrative device cache:

- Phase 1, 100 viewed originals at 3 MB: up to roughly 300 MB before native eviction;
- Phase 2, 100 card derivatives at 200 KB: roughly 20 MB, plus display/original files actually viewed.

Native cache size and eviction are platform/library managed; Coverly must not promise a fixed retained size.

## Recommended phased plan

### Phase 0 — establish baseline

Risk: **Low**

No behavioural changes.

1. Create a representative test account and image set.
2. Record image request count, response bytes, cache source, load latency, scroll behaviour, and memory.
3. Test cold install/cache, warm navigation, force-close/restart, and signed URL refresh.
4. Capture Supabase daily egress before and after repeatable scripted sessions where practical.

Exit criterion: baseline evidence confirms whether signed URL/cache identity is causing meaningful repeat body downloads.

### Phase 1A — stable image identity and shared signed URL cache

Risk: **Low–medium**

1. Add a path-aware, account-scoped image source/cache-key helper.
2. Add per-path/bucket/account signed URL query identity.
3. Preserve existing string URL hooks temporarily as adapters if that limits the regression surface.
4. Pass `{ uri, cacheKey }` into shared `expo-image` components.
5. Cover inventory originals and evidence images.
6. Keep signed-original fallback and existing placeholders/recovery.
7. Record `cacheType` in development/diagnostic metrics without logging sensitive identity.

Why not Low: this touches shared rendering used by pins, focal crops, retries, and viewers. A cache-key collision or invalidation error could show stale/wrong pixels.

### Phase 1B — auth boundary and conservative prefetch

Risk: **Low–medium**

1. Clear signed-image query state and memory image cache on auth user change.
2. Implement the approved disk-cache logout policy.
3. Prefetch only a small visible/adjacent window after interactions settle.
4. Prove prefetch and custom cache keys share bytes on iOS and Android before enabling.
5. Keep memory pressure and cellular transfer bounded.

Why not Low: global disk clearing, app lifecycle timing, and eager prefetch can create login delays, duplicated transfers, or memory pressure if implemented carelessly.

### Phase 1 decision gate

Stop after Phase 1 unless measurement shows one or more of:

- cold room/list transfer remains unacceptably high;
- warm repeat egress is fixed but overall Storage egress still approaches the Free quota;
- first-image/above-the-fold latency remains poor on target networks;
- cold scrolling still decodes too many multi-megabyte originals;
- device disk cache grows disproportionately because browsing caches originals.

Suggested initial trigger for Phase 2 discussion: a representative 20-item room still transfers more than roughly 15–25 MB on first open, or cold above-the-fold imagery consistently exceeds the agreed performance budget.

### Phase 2 — stored display derivatives

Risk: **Medium**

Only after the Phase 1 gate:

1. Define deterministic `card-768` and `display-1600` sidecar paths.
2. Generate best-effort derivatives for new inventory uploads.
3. Preserve and commit the original first.
4. Resolve derivative with original fallback.
5. Add progressive display-to-original viewer transition.
6. Do not require historical backfill.
7. Add cleanup only after shared scan-source references and ownership are proven.
8. Initially exclude claim evidence unless measured evidence-viewer use justifies derivatives.

Why Medium: upload CPU, multiple object writes, partial failures, scan-source sharing, cleanup, and historical fallback enlarge the regression surface.

### Phase 3 — hosted transformations, only if justified

Risk: **Medium**

If/when Coverly moves to Supabase Pro:

1. Compare hosted transforms with stored derivatives.
2. Prototype signed transform URLs for the same representation model.
3. Keep stable representation cache keys.
4. Keep original fallback.
5. Monitor distinct transformed origin-image usage and egress.
6. Remove stored-derivative complexity only after parity and rollback are proven.

Why Medium: the code change can be small, but runtime availability, plan/config, billing, CDN behaviour, and fallback become operational dependencies.

## Likely files affected

### Phase 1 core

Likely new file:

- `artifacts/mobile/lib/image-cache.ts` or equivalent path-aware source/cache-key helper.

Likely modified:

- `artifacts/mobile/hooks/useSignedUrls.ts`;
- `artifacts/mobile/lib/storage-helpers.ts`;
- `artifacts/mobile/components/ReliableImage.tsx`;
- `artifacts/mobile/components/ExpandableImage.tsx`;
- `artifacts/mobile/components/ImageViewerModal.tsx`;
- `artifacts/mobile/context/AuthContext.tsx` and/or `artifacts/mobile/app/_layout.tsx` for auth-boundary clearing.

Likely call-site updates:

- `artifacts/mobile/app/(tabs)/index.tsx`;
- `artifacts/mobile/app/(tabs)/property/[id].tsx`;
- `artifacts/mobile/app/(tabs)/room/[id].tsx`;
- `artifacts/mobile/app/(tabs)/item/[id].tsx`;
- `artifacts/mobile/app/(tabs)/items-needing-attention.tsx`;
- `artifacts/mobile/components/DraggablePhotoStrip.tsx`;
- `artifacts/mobile/components/ItemEvidenceSection.tsx`.

Possible local-preview adapters, only if the shared type requires them:

- `artifacts/mobile/app/(tabs)/add-item.tsx`;
- `artifacts/mobile/app/(tabs)/scan.tsx`;
- `artifacts/mobile/components/AiScanningOverlay.tsx`.

Likely tests:

- new `artifacts/mobile/lib/__tests__/image-cache-key.test.ts`;
- signed URL per-path reuse tests;
- extensions to `image-viewer-config.test.ts`;
- account-change/cache-boundary contract tests;
- existing viewer/pin/room tests retained.

### Phase 2

- `artifacts/mobile/lib/photo-upload.ts`;
- new `artifacts/mobile/lib/image-derivatives.ts`;
- `artifacts/mobile/lib/storage-helpers.ts`;
- `artifacts/mobile/hooks/useSignedUrls.ts`;
- shared image/viewer components;
- item/property/room upload call sites if the upload helper cannot hide the change;
- scan flow/service tests because one scan source can be shared by many items;
- deletion/replacement services if derivative cleanup is added.

No database migration is preferred. Storage policy/config verification may be required, but no bucket or ownership change should be assumed.

### Phase 3/backend

- signed URL transformation options in storage/source helpers;
- Supabase Dashboard transformation enablement;
- plan/usage documentation;
- possibly environment capability flags;
- no canonical DB image-field change;
- no claim-pack function change.

If a custom server derivative generator were chosen instead, it would add a new Edge Function and operational surface; that is not the preferred plan.

## Validation plan

### Baseline fixture

Use at least:

- one property cover;
- three room covers;
- one room with 20–50 item images;
- mixed portrait, landscape, HEIC-origin, JPEG, and PNG inputs;
- original object sizes spanning approximately 500 KB, 2 MB, and 5+ MB;
- several items sharing one scan source;
- one item with multiple attachments;
- image and PDF evidence;
- one legacy HTTP(S) image reference if available;
- two test accounts on the same device.

### Metrics

Collect:

- signed URL creation request count;
- image body GET count;
- transferred response bytes;
- `expo-image` load cache type;
- time to first above-the-fold image;
- time until all visible images settle;
- item detail hero time;
- expand-to-first-pixel time;
- expand-to-original time;
- scroll dropped-frame/jank observations;
- memory high-water mark where tooling permits;
- native cache footprint before/after a large inventory pass;
- Supabase project egress over repeatable test windows.

Do not log signed URLs, user paths, receipts, or cache keys.

### Scenarios

1. **Cold:** clear app/cache or reinstall, then open property → room → item.
2. **Warm navigation:** room → item → back, repeated three times.
3. **Cross-context:** dashboard search → room card → item detail → viewer.
4. **Warm restart:** force-close and reopen without clearing app data.
5. **URL refresh:** wait past refresh or use a safe development TTL to force a new signed URL.
6. **Viewer paging:** swipe through multiple item images forward and back.
7. **Replacement:** replace property, room, and item images; confirm new pixels immediately.
8. **Deletion:** delete item/evidence/room references; confirm no UI exposure or crash.
9. **Move:** move an item between rooms; confirm cache remains valid.
10. **Account boundary:** login A, warm images, logout, login B; confirm no A pixels appear.
11. **Eviction:** clear native cache/simulate low storage, then confirm remote fallback.
12. **Offline warm:** after warming, navigate offline where cached rendering should succeed.
13. **Offline cold:** confirm placeholders/errors and later retry remain correct.
14. **Large inventory:** rapid scroll in detailed and compact modes.
15. **Platforms:** current supported iOS and Android, including one lower-end Android.
16. **Claims:** generate a pack and compare original image/evidence inclusion and quality.

### Image-quality review

At 2× and 3× density:

- inspect fine text, serial labels, fabric texture, and room-wide detail;
- inspect cropped cards and focal pin crops;
- inspect portrait and landscape heroes;
- compare display derivative to original at normal UI scale;
- verify full-screen final image dimensions/quality are unchanged;
- verify transition does not flash, jump crop, or misalign pins.

## Acceptance criteria

### Phase 1

- Original Supabase objects and canonical database references are unchanged.
- No database or Storage migration is required.
- No new dependency is installed.
- Existing storage paths and historical images continue through current fallback behaviour.
- A cache miss or eviction resolves and displays the current remote original.
- A new signed URL for an unchanged path can reuse the same native cached bytes.
- Repeated warm navigation produces at least 80% fewer unchanged image body bytes than the measured baseline, or a documented result explains why the baseline was already cache-efficient.
- A warm app restart does not redownload unchanged cached image bodies solely because URLs were re-signed.
- Cold Phase 1 loading is no more than 10% slower in the representative fixture.
- Item, room, property, and evidence replacement cannot remain indefinitely stale.
- Same-path overwrite remains prohibited or uses an explicit version.
- Account B never renders account A's cached imagery.
- Logout/account-switch cache behaviour matches the approved privacy policy.
- Cache clearing, low storage, OS eviction, and reinstall do not break images.
- Pin alignment, focal crops, viewers, paging, and retries retain current behaviour.
- Claim-pack generation and evidence source quality are unchanged.
- No sensitive image identity is added to logs.

### Phase 2, if approved later

- Original objects remain available and unchanged.
- Canonical DB references still point to originals.
- Derivative absence/failure always falls back to original.
- Existing users require no action and no mandatory backfill.
- Card/display images are visually sharp on 3× devices.
- Representative cold list bytes fall by at least 70%, with a target of 80–95%.
- Full-screen opens immediately with the best cached representation.
- The viewer transitions to the original without a visible crop jump or pin shift.
- Claims and evidence use the correct original/source-quality assets.
- Partial derivative upload failure does not fail an otherwise successful image save.

## Decisions requested before implementation

1. **Definition of original:** for future work, does “original” mean the current canonical Supabase upload output, or the untouched device camera/library source? Phase 1 does not depend on this decision.
2. **Logout privacy policy:** approve the recommended global `expo-image` memory and disk cache clear on explicit logout/account switch, accepting that the next login will redownload images.
3. **Phase 1 evidence scope:** recommendation is to include evidence images in the path-aware cache while leaving PDFs and claim-pack generation unchanged.
4. **Phase 2 gate:** approve measurement-first gating rather than committing now to derivatives or Supabase Pro.

## Done looks like

For this investigation:

- current upload, persistence, signing, rendering, evidence, scan, viewer, auth, and claim paths are documented;
- the primary egress causes are tied to repository code;
- Phase 1 is additive and Free-compatible;
- later options retain original fallback;
- risks, files, validation, and acceptance criteria are explicit;
- no production code, dependency, migration, Supabase configuration, upload pipeline, or claim behaviour has changed.
