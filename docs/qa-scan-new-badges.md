# Scanned-item New badge manual QA

1. Complete a scan and confirm every item saved by that scan shows **New**.
2. Wait at least 30 seconds and confirm every badge remains.
3. Open one new item, then return to the Room and confirm only that item's badge cleared.
4. Leave the Room without opening an item, re-enter it, and confirm all badges cleared.
5. Run a second scan and confirm only the second scan batch shows **New**.
6. Search, filter, sort, and switch list layouts; confirm badges remain attached to the correct IDs.
7. Delete or move a new item and confirm no badge moves to another card or causes an error.
8. Refresh the Room and confirm refresh alone does not recreate consumed badges.

No database or Supabase changes are involved in this behavior.
