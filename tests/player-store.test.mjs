// 玩家追踪存储层（cloudfunctions/apex/playerStore.js）的测试。
// 用假 cloud 录下数据库调用，验证三件事：
//   1. 集合名、查询条件、写的文档形状对不对
//   2. 配额用的 count、增删查是不是按 openid 隔离
//   3. 任何数据库错误都吞掉降级，绝不往上抛

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "..", "cloudfunctions", "apex", "playerStore.js");
if (!existsSync(MOD)) throw new Error("缺少 " + MOD + " —— 先写实现再跑");
const require = createRequire(import.meta.url);
const { createPlayerStore, TRACKED, SNAPS } = require(MOD);

const NOW = 1800000000000;

function makeCloud(opts = {}) {
  const log = { adds: [], queries: [], updates: [], removes: [], counts: [] };
  const cmd = { lt: (v) => ({ op: "lt", v }) };

  const gettable = (name, q) => ({
    get: async () => {
      log.queries.push({ name, q });
      if (opts.getThrows) throw new Error("读失败");
      return { data: opts.docs || [] };
    },
  });
  const whereable = (name, q) => ({
    count: async () => {
      log.counts.push({ name, q });
      if (opts.countThrows) throw new Error("数失败");
      return { total: opts.total == null ? 0 : opts.total };
    },
    remove: async () => {
      log.removes.push({ name, q });
      if (opts.removeThrows) throw new Error("删失败");
      return { stats: { removed: 1 } };
    },
    update: async ({ data }) => {
      log.updates.push({ name, q, data });
      if (opts.updateThrows) throw new Error("更新失败");
      return {};
    },
    orderBy: () => ({ limit: () => gettable(name, q) }),
  });

  const collection = (name) => ({
    where: (q) => whereable(name, q),
    limit: () => gettable(name, null),
    add: async ({ data }) => {
      log.adds.push({ name, data });
      if (opts.addThrows) throw new Error(typeof opts.addThrows === "string" ? opts.addThrows : "写失败");
      return { _id: data._id };
    },
  });

  return { database: () => ({ command: cmd, collection }), log };
}

const player = (over = {}) => Object.assign({
  uid: "2262951949", name: "shroud", level: 255,
  rankName: "Diamond", rankDiv: 2, rankScore: 12345,
}, over);

describe("玩家追踪存储 · 集合名", () => {
  test("两个集合名固定，方便控制台建", () => {
    assert.equal(TRACKED, "tracked_players");
    assert.equal(SNAPS, "player_rank_snapshots");
  });
});

describe("玩家追踪存储 · 名单", () => {
  test("add 写入的文档形状对，且带归属 openid", async () => {
    const cloud = makeCloud({});
    const s = createPlayerStore(cloud);
    const ok = await s.add({ uid: "2262951949", platform: "PC", name: "shroud", addedBy: "openid-1", addedAt: NOW });
    assert.equal(ok, true);
    const d = cloud.log.adds[0].data;
    assert.equal(cloud.log.adds[0].name, "tracked_players");
    assert.equal(d.uid, "2262951949");
    assert.equal(d.addedBy, "openid-1");
    assert.equal(d.lastRp, null);
  });

  test("countBy 按 openid 数，返回 total", async () => {
    const cloud = makeCloud({ total: 4 });
    const s = createPlayerStore(cloud);
    assert.equal(await s.countBy("openid-1"), 4);
    assert.deepEqual(cloud.log.counts[0].q, { addedBy: "openid-1" });
  });

  test("countBy 查库失败按 0 降级，不抛", async () => {
    const s = createPlayerStore(makeCloud({ countThrows: true }));
    await assert.doesNotReject(async () => assert.equal(await s.countBy("x"), 0));
  });

  test("listBy 只查自己的，失败返回空数组", async () => {
    const s = createPlayerStore(makeCloud({ docs: [{ uid: "1" }] }));
    assert.deepEqual(await s.listBy("openid-1"), [{ uid: "1" }]);
    assert.deepEqual(await createPlayerStore(makeCloud({ getThrows: true })).listBy("x"), []);
  });

  test("removeBy 同时按 openid 和 uid 删（不能删到别人追踪的）", async () => {
    const cloud = makeCloud({});
    const s = createPlayerStore(cloud);
    const ok = await s.removeBy("openid-1", "2262951949");
    assert.equal(ok, true);
    assert.deepEqual(cloud.log.removes[0].q, { addedBy: "openid-1", uid: "2262951949" });
  });

  test("add 失败返回 false，不抛", async () => {
    const s = createPlayerStore(makeCloud({ addThrows: true }));
    await assert.doesNotReject(async () => assert.equal(await s.add({ uid: "1", addedBy: "x" }), false));
  });
});

describe("玩家追踪存储 · 快照", () => {
  test("writeSnapshot 写一条含 uid/rp 的快照，并顺手清理 30 天前", async () => {
    const cloud = makeCloud({});
    const s = createPlayerStore(cloud);
    await s.writeSnapshot("2262951949", player(), NOW);
    const d = cloud.log.adds.find((a) => a.name === "player_rank_snapshots").data;
    assert.equal(d.uid, "2262951949");
    assert.equal(d.rp, 12345);
    assert.equal(d.rankName, "Diamond");
    assert.equal(cloud.log.removes.length, 1);
    assert.equal(cloud.log.removes[0].name, "player_rank_snapshots");
  });

  test("没有分数不写快照", async () => {
    const cloud = makeCloud({});
    const s = createPlayerStore(cloud);
    await s.writeSnapshot("1", player({ rankScore: null }), NOW);
    assert.equal(cloud.log.adds.filter((a) => a.name === "player_rank_snapshots").length, 0);
  });

  test("readBasis 按 uid 查，交给 pickBasis 挑", async () => {
    const H = 3600 * 1000;
    const cloud = makeCloud({ docs: [{ at: NOW - 23 * H, rp: 10000 }] });
    const s = createPlayerStore(cloud);
    const b = await s.readBasis("2262951949", NOW);
    assert.equal(b.rp, 10000);
    assert.deepEqual(cloud.log.queries[0].q, { uid: "2262951949" });
  });

  test("touchTracked 把最新分数回写进名单", async () => {
    const cloud = makeCloud({});
    const s = createPlayerStore(cloud);
    await s.touchTracked("2262951949", player());
    const u = cloud.log.updates[0];
    assert.equal(u.name, "tracked_players");
    assert.equal(u.data.lastRp, 12345);
    assert.equal(u.data.lastRankName, "Diamond");
  });
});
