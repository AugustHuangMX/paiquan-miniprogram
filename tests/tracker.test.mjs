// 排位追踪 action（handler.js 里的 trackAdd / trackList / trackRemove）的测试。
// 用假 fetch 和假 playerStore，验证：
//   1. 配额（每人 5 个）、验人、增删查
//   2. 网页版没有数据库 → 一律降级成「仅小程序可用」
//   3. 涨幅文案：有基准才算，没基准/没分数绝不给假数字

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const h = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "handler.js"));

const KEY = "test-key";
const OPENID = "openid-1";

const json = (o) => ({ status: 200, text: async () => JSON.stringify(o) });
const notFound = () => ({ status: 404, text: async () => JSON.stringify({ Error: "Player not found." }) });

function makeStore(opts = {}) {
  const store = {
    calls: [],
    countBy: async () => { store.calls.push("countBy"); return opts.count == null ? 0 : opts.count; },
    add: async (entry) => { store.calls.push("add"); store.added = entry; return opts.addResult !== false; },
    listBy: async () => { store.calls.push("listBy"); return opts.list || []; },
    removeBy: async (openid, uid) => { store.calls.push("removeBy"); store.removed = { openid, uid }; return opts.removeResult !== false; },
    readBasis: async () => { store.calls.push("readBasis"); return opts.basis || null; },
  };
  return store;
}

const trackDeps = (over = {}) => Object.assign({
  apiKey: KEY,
  openid: OPENID,
  playerStore: makeStore(),
  fetchImpl: () => json({ global: { name: "shroud", uid: "2262951949", platform: "PC", level: 255, rank: { rankName: "Diamond", rankDiv: 2, rankScore: 12345 } } }),
}, over);

describe("track · 降级与校验", () => {
  test("没有 playerStore（网页版）→ 一律 unsupported", async () => {
    const r = await h.handle({ action: "trackList" }, { apiKey: KEY });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "unsupported");
  });

  test("没有 openid → badparam", async () => {
    const r = await h.handle({ action: "trackList" }, { apiKey: KEY, playerStore: makeStore() });
    assert.equal(r.kind, "badparam");
  });

  test("trackAdd 给的不是纯数字 uid → badparam", async () => {
    const r = await h.handle({ action: "trackAdd", uid: "abc" }, trackDeps());
    assert.equal(r.kind, "badparam");
  });
});

describe("track · 添加", () => {
  test("已满 5 个 → quota，且不打上游（省额度）", async () => {
    const store = makeStore({ count: 5 });
    let fetched = false;
    const deps = trackDeps({ playerStore: store, fetchImpl: () => { fetched = true; return json({}); } });
    const r = await h.handle({ action: "trackAdd", uid: "2262951949" }, deps);
    assert.equal(r.kind, "quota");
    assert.equal(fetched, false, "满额就不该再验人，白打一次上游");
  });

  test("uid 查不到 → notfound，不进名单", async () => {
    const store = makeStore();
    const r = await h.handle({ action: "trackAdd", uid: "2262951949" }, trackDeps({ playerStore: store, fetchImpl: notFound }));
    assert.equal(r.kind, "notfound");
    assert.equal(store.calls.includes("add"), false);
  });

  test("成功 → 用上游的规范名和平台写名单", async () => {
    const store = makeStore();
    const r = await h.handle({ action: "trackAdd", uid: "2262951949" }, trackDeps({ playerStore: store }));
    assert.equal(r.ok, true);
    assert.equal(r.data.added.name, "shroud");
    assert.equal(store.added.addedBy, OPENID);
    assert.equal(store.added.uid, "2262951949");
  });

  test("名单写不进去 → 报错不假装成功", async () => {
    const store = makeStore({ addResult: false });
    const r = await h.handle({ action: "trackAdd", uid: "2262951949" }, trackDeps({ playerStore: store }));
    assert.equal(r.ok, false);
  });
});

describe("track · 列表与删除", () => {
  test("trackList 返回名单并算较昨日涨幅", async () => {
    const store = makeStore({
      list: [{ uid: "2262951949", name: "shroud", platform: "PC", lastRp: 12345, lastRankName: "Diamond" }],
      basis: { at: Date.now() - 24 * 3600 * 1000, rp: 10000 },
    });
    const r = await h.handle({ action: "trackList" }, trackDeps({ playerStore: store }));
    assert.equal(r.ok, true);
    assert.equal(r.data.quota, 5);
    assert.equal(r.data.list[0].deltaText, "+2,345");
    assert.equal(r.data.list[0].name, "shroud");
  });

  test("没有基准 → deltaText 空串，绝不显示 +0", async () => {
    const store = makeStore({
      list: [{ uid: "1", name: "x", lastRp: 12345 }],
      basis: null,
    });
    const r = await h.handle({ action: "trackList" }, trackDeps({ playerStore: store }));
    assert.equal(r.data.list[0].deltaText, "");
  });

  test("trackRemove 按 openid + uid 删", async () => {
    const store = makeStore();
    const r = await h.handle({ action: "trackRemove", uid: "2262951949" }, trackDeps({ playerStore: store }));
    assert.equal(r.ok, true);
    assert.deepEqual(store.removed, { openid: OPENID, uid: "2262951949" });
  });
});
