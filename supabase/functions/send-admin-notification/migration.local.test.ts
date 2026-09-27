import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

import { isExpoPushToken } from "./model.ts";

// Optional standalone test tooling, installed outside the application workspace.
// An explicit local module path is required; no database URL or credentials are used.
const modulePath = process.env.COVERLY_PGLITE_MODULE;
assert.ok(
  modulePath && isAbsolute(modulePath),
  "Set COVERLY_PGLITE_MODULE to the absolute path of PGlite's dist/index.js (see docs/admin-signup-notifications.md).",
);
const { PGlite } = await import(pathToFileURL(modulePath).href);
const database = new PGlite(); // Fresh, in-memory PostgreSQL; never a server connection.
const adminId = "b53f8ad4-5bf0-4aea-8cbb-ea5636569f10";
const migration = readFileSync(
  new URL(
    "../../migrations/20260816215401_admin_signup_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

before(async () => {
  // Only the pre-existing objects required by this migration are stubbed.
  await database.exec(`
    SET standard_conforming_strings = on;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY REFERENCES auth.users(id));
    INSERT INTO auth.users VALUES ('${adminId}', 'admin@example.test');
    INSERT INTO public.user_profiles VALUES ('${adminId}');
  `);
  await database.exec(migration);
});

after(async () => {
  await database.close();
});

test("SQL constraint and handler accept both Expo token prefixes", async () => {
  for (const token of [
    "ExpoPushToken[abc_123-XYZ]",
    "ExponentPushToken[XYZ-123_abc]",
  ]) {
    assert.equal(isExpoPushToken(token), true);
    await database.query(
      "INSERT INTO public.admin_notification_devices(admin_user_id, expo_push_token, platform) VALUES ($1, $2, 'ios')",
      [adminId, token],
    );
  }
});

test("SQL constraint and handler reject malformed tokens", async () => {
  for (const token of [
    "secret",
    "",
    "ExpoPushToken[]",
    "ExpoPushTokenabc",
    "expoPushToken[abc]",
    "ExpoPushToken[a b]",
    "ExpoPushToken[a/b]",
    "ExpoPushToken[abc]suffix",
    " ExpoPushToken[abc]",
    "ExpoPushToken[abc]\n",
    "ExpoPushToken[abc]\r\n",
    String.raw`ExpoPushToken\[abc\]`,
  ]) {
    assert.equal(isExpoPushToken(token), false, JSON.stringify(token));
    await assert.rejects(
      database.query(
        "INSERT INTO public.admin_notification_devices(admin_user_id, expo_push_token, platform) VALUES ($1, $2, 'ios')",
        [adminId, token],
      ),
      { code: "23514" },
      JSON.stringify(token),
    );
  }
});

test("auth insert queues one pending signup notification", async () => {
  const userId = "5ceea882-eaa4-41c7-ad16-780d332a2148";
  await database.query("INSERT INTO auth.users VALUES ($1, $2)", [
    userId,
    "signup@example.test",
  ]);
  const { rows } = await database.query(
    "SELECT type, email, status, attempts FROM public.admin_notifications WHERE user_id = $1",
    [userId],
  );
  assert.deepEqual(rows, [
    {
      type: "new_user",
      email: "signup@example.test",
      status: "pending",
      attempts: 0,
    },
  ]);
});

test("internal tables enforce RLS and deny client reads and writes", async () => {
  for (const table of ["admin_notification_devices", "admin_notifications"]) {
    const { rows } = await database.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass",
      [`public.${table}`],
    );
    assert.equal(rows[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      await database.exec(`SET ROLE ${role}`);
      try {
        await assert.rejects(database.query(`SELECT * FROM public.${table}`), {
          code: "42501",
        });
        await assert.rejects(
          database.query(`INSERT INTO public.${table} DEFAULT VALUES`),
          { code: "42501" },
        );
      } finally {
        await database.exec("RESET ROLE");
      }
    }
  }
});

test("queue insertion failure does not prevent auth user creation", async () => {
  const userId = "bd3e8f50-2765-4aeb-b2ef-a015c258d239";
  await database.exec(
    "ALTER TABLE public.admin_notifications ADD CONSTRAINT simulate_queue_failure CHECK (false) NOT VALID",
  );
  try {
    await database.query("INSERT INTO auth.users VALUES ($1, $2)", [
      userId,
      "failure@example.test",
    ]);
    const user = await database.query(
      "SELECT id FROM auth.users WHERE id = $1",
      [userId],
    );
    const queued = await database.query(
      "SELECT id FROM public.admin_notifications WHERE user_id = $1",
      [userId],
    );
    assert.equal(user.rows.length, 1);
    assert.equal(queued.rows.length, 0);
  } finally {
    await database.exec(
      "ALTER TABLE public.admin_notifications DROP CONSTRAINT simulate_queue_failure",
    );
  }
});
