import assert from "node:assert/strict";
import test from "node:test";
import { createScanHandler } from "../scan-room-photo/handler.ts";
import { createSearchHandler } from "../replacement-price-search/handler.ts";
import {
  prepareScanWorkload,
  validateScanWorkload,
  MAX_IMAGE_BYTES,
  MAX_SCAN_BYTES,
} from "../scan-room-photo/workload.ts";
import { fingerprint, UsageError } from "./trusted-usage.ts";

globalThis.fetch = async () => {
  throw new Error("Live network prohibited");
};
const uid = "11111111-1111-4111-8111-111111111111";
const file = "file-existing-text-id",
  item = "item-existing-text-id";
const image = {
  id: "photo_1",
  imageBase64: btoa(String.fromCharCode(255, 216, 255, 219, 0)),
  mimeType: "image/jpeg",
};
const scanBody = () => ({
  mode: "single_photo",
  images: [image],
  context: { fileId: file },
  usageIdempotencyKey: "op-1",
});
const searchBody = () => ({
  itemId: item,
  itemName: "Chair",
  usageIdempotencyKey: "op-1",
});
function setup(route: "scan" | "search") {
  const calls: any[] = [];
  const network: any[] = [];
  const operations = new Map<string, any>();
  const state = {
    deny: "",
    rpcFailure: "",
    settleFalse: false,
    startFalse: false,
    provider: "success",
    invalidAuth: false,
    bytes: new Uint8Array([255, 216, 255, 219, 0]),
  };
  const client = (url: string, key: string) => ({
    auth: {
      getUser: async () => ({
        data: { user: state.invalidAuth ? null : { id: uid } },
        error: null,
      }),
    },
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data:
            table === "inventory_items"
              ? { id: item, file_id: file }
              : { id: file, country_code: "NZ", currency_code: "NZD" },
          error: null,
        }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([state.bytes], { type: "image/jpeg" }),
          error: null,
        }),
      }),
    },
    async rpc(name: string, args: any) {
      assert.equal(key, "service-key", "user clients cannot mutate accounting");
      assert.equal(args.p_user_id, uid);
      calls.push({ name, args });
      if (state.rpcFailure === name)
        return { data: null, error: { message: "fixture" } };
      let data: any;
      if (name === "reserve_feature_usage") {
        if (state.deny)
          data = {
            execute: false,
            code: state.deny,
            status: "denied",
            policy_class: "owned",
          };
        else if (operations.has(args.p_key)) {
          const r = operations.get(args.p_key);
          data = {
            execute: false,
            code:
              r.fingerprint !== args.p_fingerprint
                ? "IDEMPOTENCY_CONFLICT"
                : r.status === "committed"
                  ? "OPERATION_COMPLETED"
                  : r.status === "refunded"
                    ? "OPERATION_REFUNDED"
                    : "OPERATION_IN_PROGRESS",
            status: r.status,
          };
        } else {
          const r = {
            fingerprint: args.p_fingerprint,
            status: "reserved",
            reservation_id: "reservation-1",
            execution_token: "token",
            execute: true,
            allowed: true,
            policy_class: "owned",
            is_bypassed: false,
            units: route === "scan" ? 1 : 1,
            used_units: 0,
            reserved_units: 1,
            remaining_units: 9,
            limit_units: 10,
          };
          operations.set(args.p_key, r);
          data = r;
        }
      } else if (name === "start_feature_provider_attempt")
        data = { execute: !state.startFalse, code: "EXECUTION_CLAIM_LOST" };
      else if (name === "finish_feature_provider_attempt") data = { ok: true };
      else if (name === "settle_feature_usage") {
        data = { ok: !state.settleFalse, status: args.p_outcome };
        if (data.ok)
          for (const r of operations.values()) r.status = args.p_outcome;
      } else throw new Error(name);
      return { data, error: null };
    },
  });
  const env = (key: string) =>
    (
      ({
        SUPABASE_URL: "https://fixture",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        OPENAI_API_KEY: "fixture-ai",
        SERPER_API_KEY: "fixture-serper",
      }) as any
    )[key];
  const request: typeof fetch = async (url, init) => {
    network.push({ url, body: JSON.parse(String(init?.body)) });
    if (state.provider === "timeout")
      throw new DOMException("timeout", "AbortError");
    if (state.provider === "error")
      return Response.json({ error: { message: "fixture" } }, { status: 500 });
    if (state.provider === "invalid")
      return new Response("not json", { status: 200 });
    if (route === "scan")
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(
                state.provider === "empty"
                  ? []
                  : [
                      {
                        name: "Chair",
                        category: "Furniture",
                        unitEstimatedPrice: 100,
                        estimatedPrice: 100,
                        currencyCode: "NZD",
                        quantity: 1,
                      },
                    ],
              ),
            },
          },
        ],
      });
    return Response.json(
      state.provider === "empty"
        ? { shopping: [], organic: [] }
        : {
            shopping: [
              {
                title: "Chair",
                source: "Fixture",
                price: "NZ$100",
                link: "https://fixture.co.nz/chair",
              },
            ],
          },
    );
  };
  const handler =
    route === "scan"
      ? createScanHandler(client as any, env, request)
      : createSearchHandler(client as any, env, request);
  const body = route === "scan" ? scanBody : searchBody;
  const invoke = (input: any = body()) =>
    handler(
      new Request("https://fixture", {
        method: "POST",
        headers: { authorization: "Bearer valid" },
        body: JSON.stringify(input),
      }),
    );
  return { calls, network, state, invoke, body, operations };
}
for (const route of ["scan", "search"] as const) {
  test(`${route}: policy denial, invalid auth, reservation failure and lost execution claim call no provider`, async () => {
    for (const mode of ["denial", "auth", "reserve", "start"]) {
      const f = setup(route);
      if (mode === "denial") f.state.deny = "OWNER_FAIR_USE_EXHAUSTED";
      if (mode === "auth") f.state.invalidAuth = true;
      if (mode === "reserve") f.state.rpcFailure = "reserve_feature_usage";
      if (mode === "start") f.state.startFalse = true;
      const response = await f.invoke();
      assert.equal(
        response.status,
        mode === "denial"
          ? 429
          : mode === "auth"
            ? 401
            : mode === "start"
              ? 409
              : 503,
      );
      assert.equal(f.network.length, 0);
      if (mode === "denial")
        assert.doesNotMatch(
          JSON.stringify(await response.json()),
          /Upgrade|Plus/,
        );
    }
  });
  test(`${route}: success invokes provider once, records attempt, commits once and completed replay cannot rerun`, async () => {
    const f = setup(route);
    const r = await f.invoke();
    assert.equal(r.status, 200);
    assert.equal((await r.json()).diagnostics.usage.status, "committed");
    assert.equal(f.network.length, 1);
    assert.equal(
      f.calls.filter((c) => c.name === "settle_feature_usage").length,
      1,
    );
    const replay = await f.invoke();
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).errorCode, "OPERATION_COMPLETED");
    assert.equal(f.network.length, 1);
    assert.equal(
      f.calls.filter((c) => c.name === "finish_feature_provider_attempt")
        .length,
      1,
    );
  });
  test(`${route}: input fingerprint conflict never reruns provider`, async () => {
    const f = setup(route);
    await f.invoke();
    const changed: any = f.body();
    if (route === "scan")
      changed.images = [
        {
          ...image,
          imageBase64: btoa(String.fromCharCode(255, 216, 255, 219, 1)),
        },
      ];
    else changed.itemName = "Different chair";
    const r = await f.invoke(changed);
    assert.equal((await r.json()).errorCode, "IDEMPOTENCY_CONFLICT");
    assert.equal(f.network.length, 1);
  });
  test(`${route}: provider errors/timeouts/invalid responses refund once and terminal retry cannot rerun`, async () => {
    for (const provider of ["error", "timeout", "invalid"]) {
      const f = setup(route);
      f.state.provider = provider;
      assert.ok((await f.invoke()).status >= 500);
      const settled = f.calls.filter((c) => c.name === "settle_feature_usage");
      assert.equal(settled.length, 1);
      assert.equal(settled[0].args.p_outcome, "refunded");
      assert.equal((await f.invoke()).status, 409);
      assert.equal(f.network.length, 1);
    }
  });
  test(`${route}: no usable results refund allowance but preserve provider-attempt telemetry`, async () => {
    const f = setup(route);
    f.state.provider = "empty";
    assert.equal((await f.invoke()).status, 200);
    assert.equal(
      f.calls.find((c) => c.name === "settle_feature_usage").args.p_outcome,
      "refunded",
    );
    assert.equal(
      f.calls.filter((c) => c.name === "finish_feature_provider_attempt")
        .length,
      route === "scan" ? 1 : 2,
    );
  });
  test(`${route}: failed commit is surfaced without attempted refund or silent success`, async () => {
    for (const explicitFalse of [true, false]) {
      const f = setup(route);
      f.state.settleFalse = explicitFalse;
      if (!explicitFalse) f.state.rpcFailure = "settle_feature_usage";
      const r = await f.invoke();
      assert.equal(r.status, 503);
      assert.equal((await r.json()).errorCode, "USAGE_SETTLEMENT_FAILED");
      assert.equal(
        f.calls.filter((c) => c.name === "settle_feature_usage").length,
        1,
      );
      assert.equal(f.network.length, 1);
    }
  });
  test(`${route}: failed refund and failed telemetry return explicit service errors`, async () => {
    const f = setup(route);
    f.state.provider = "error";
    f.state.rpcFailure = "settle_feature_usage";
    assert.equal((await f.invoke()).status, 503);
    assert.equal(
      f.calls.filter((c) => c.name === "settle_feature_usage").length,
      1,
    );
    const t = setup(route);
    t.state.rpcFailure = "finish_feature_provider_attempt";
    const r = await t.invoke();
    assert.equal((await r.json()).errorCode, "USAGE_TELEMETRY_FAILED");
    assert.equal(t.network.length, 1);
  });
  test(`${route}: in-flight duplicate is denied without invoking provider`, async () => {
    const f = setup(route);
    f.state.deny = "OPERATION_IN_PROGRESS";
    assert.equal((await f.invoke()).status, 409);
    assert.equal(f.network.length, 0);
  });
}

test("scan workload rejects forged single mode, excessive frames, malformed representations and wrong MIME before provider", async () => {
  for (const change of [
    { mode: "single_photo", images: [image, image] },
    { mode: "multi_photo", images: Array(6).fill(image) },
    { mode: "video_frames", images: Array(21).fill(image) },
    { mode: "invented" },
    { images: [{ ...image, storagePath: "also-a-path" }] },
    { images: [{ ...image, mimeType: "text/html" }] },
    { images: [{ ...image, imageBase64: "notbase64" }] },
  ]) {
    const f = setup("scan");
    assert.equal((await f.invoke({ ...f.body(), ...change })).status, 400);
    assert.equal(f.network.length, 0);
    assert.equal(f.calls.length, 0);
  }
});
test("scan workloads retain one/five/twenty image limits and operation weights", () => {
  assert.equal(validateScanWorkload(scanBody()), "single_photo_scan");
  assert.equal(
    validateScanWorkload({
      ...scanBody(),
      mode: "multi_photo",
      images: Array(5).fill(image),
    }),
    "multi_photo_scan",
  );
  assert.equal(
    validateScanWorkload({
      ...scanBody(),
      mode: "video_frames",
      images: Array(20).fill(image),
    }),
    "video_frame_scan",
  );
});
test("storage content is bounded, owned and immutable for fingerprint and provider input", async () => {
  const f = setup("scan");
  const body = {
    ...scanBody(),
    images: [
      {
        id: "one",
        storagePath: `${uid}/${file}/photo.jpg`,
        mimeType: "image/jpeg",
      },
    ],
  };
  assert.equal((await f.invoke(body)).status, 200);
  const sent = f.network[0].body.messages
    .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
    .find((v: any) => v.type === "image_url").image_url.url;
  assert.ok(sent.endsWith(image.imageBase64));
  f.state.bytes = new Uint8Array([255, 216, 255, 219, 1]);
  assert.equal((await f.invoke(body)).status, 409);
  assert.equal(f.network.length, 1);
  await assert.rejects(
    prepareScanWorkload(
      {
        ...body,
        images: [{ id: "one", storagePath: `another/${file}/photo.jpg` }],
      },
      uid,
      file,
      async () => new Blob(),
    ),
    UsageError,
  );
  await assert.rejects(
    prepareScanWorkload(
      body,
      uid,
      file,
      async () => new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)]),
    ),
    UsageError,
  );
});
test("search rejects unbounded or invalid query payload before provider", async () => {
  for (const body of [
    { ...searchBody(), num: 99 },
    { ...searchBody(), itemName: 42 },
    { ...searchBody(), description: "x".repeat(70000) },
  ]) {
    const f = setup("search");
    assert.equal((await f.invoke(body)).status, 400);
    assert.equal(f.network.length, 0);
  }
});
test("fingerprints are deterministic, key-order independent and include material context", async () => {
  assert.equal(
    await fingerprint({ a: 1, b: 2 }),
    await fingerprint({ b: 2, a: 1 }),
  );
  assert.notEqual(await fingerprint({ a: 1 }), await fingerprint({ a: 2 }));
});
