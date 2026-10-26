// 快照存储（cloudfunctions/apex/store.js）的测试。
//
// 这一层我**没法在本机连真库验证**（那是腾讯云上的云开发数据库），
// 所以用一个假 cloud 把数据库调用录下来，验证三件事：
//   1. 查的是不是 20~28 小时这个区间（查错了就永远没有涨幅）
//   2. 写的文档对不对（只记分数、按小时分桶）
//   3. **任何数据库错误都必须被吞掉降级**，绝不能让用户看不到分数线
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(HERE, "..", "cloudfunctions", "apex", "store.js");
const CORE = path.resolve(HERE, "..", "cloudfunctions", "apex", "core.js");
if (!existsSync(STORE)) throw new Error("缺少 " + STORE + " —— 先写实现再跑");
const require = createRequire(import.meta.url);
const { createStore, COLLECTION } = require(STORE);
const core = require(CORE);
const snap = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "snapshot.js"));

const H = 3600 * 1000;
const NOW = 1800000000000;

/** 假 cloud：把数据库调用录下来，并按需抛错 */
function makeCloud(opts = {}) {
  const log = { queries: [], adds: [], removes: [] };

  const cmd = {
    gte: (v) => ({ op: "gte", v, and: (other) => ({ op: "range", from: v, to: other.v }) }),
    lte: (v) => ({ op: "lte", v }),
    lt: (v) => ({ op: "lt", v }),
  };

  const collection = (name) => ({
    where(q) {
      return {
        orderBy: () => ({
          limit: () => ({
            get: async () => {
              log.queries.push({ name, q });
              if (opts.getThrows) throw new Error("集合不存在或权限不对");
              return { data: opts.docs || [] };
            },
          }),
        }),
        remove: async () => {
          log.removes.push({ name, q });
          if (opts.removeThrows) throw new Error("清理失败");
          return { stats: { removed: 1 } };
        },
      };
    },
    add: async ({ data }) => {
      log.adds.push({ name, data });
      if (opts.addThrows) throw new Error(typeof opts.addThrows === "string" ? opts.addThrows : "写不进去");
      return { _id: data._id };
    },
  });

  return { database: () => ({ command: cmd, collection }), log };
}

const group = () => core.normalizePredator({ RP: {
  PC: { val: 28685, foundRank: 750, totalMastersAndPreds: 4000, updateTimestamp: Math.round((NOW - 600000) / 1000) },
  PS4: { val: 24000, foundRank: 750, totalMastersAndPreds: 2000, updateTimestamp: Math.round((NOW - 600000) / 1000) },
} });

describe("快照存储 · 集合名", () => {
  test("集合名固定，方便控制台里对着建", () => {
    assert.equal(COLLECTION, "predator_snapshots");
  });
});

describe("快照存储 · 读基准", () => {
  test("查的是 20~28 小时前这个区间（范围错了就永远没有涨幅）", async () => {
    const cloud = makeCloud({ docs: [] });
    const store = createStore(cloud);
    await store.readBasis(NOW);
    const q = cloud.log.queries[0].q;
    assert.equal(q.at.op, "range");
    assert.equal(q.at.from, NOW - core.DELTA_MAX_AGE_MS, "下界是 28 小时前");
    assert.equal(q.at.to, NOW - core.DELTA_MIN_AGE_MS, "上界是 20 小时前");
    assert.equal(cloud.log.queries[0].name, "predator_snapshots");
  });

  test("多条候选时交给 pickBasis 挑最接近 24 小时的", async () => {
    const cloud = makeCloud({ docs: [
      { at: NOW - 21 * H, plats: { PC: { rp: 100 } } },
      { at: NOW - 23.9 * H, plats: { PC: { rp: 200 } } },
      { at: NOW - 27 * H, plats: { PC: { rp: 300 } } },
    ] });
    const store = createStore(cloud);
    const b = await store.readBasis(NOW);
    assert.equal(b.at, NOW - 23.9 * H);
    assert.equal(b.plats.PC.rp, 200);
  });

  test("查库抛错 → 返回 null，不往上抛（用户看不到涨幅而已，分数线照看）", async () => {
    const store = createStore(makeCloud({ getThrows: true }));
    await assert.doesNotReject(async () => { assert.equal(await store.readBasis(NOW), null); });
  });

  test("返回体里没有 data 也不崩", async () => {
    const cloud = makeCloud({});
    cloud.database = () => ({
      command: { gte: () => ({ and: () => ({}) }), lte: () => ({}), lt: () => ({}) },
      collection: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => null }) }) }) }),
    });
    const store = createStore(cloud);
    assert.equal(await store.readBasis(NOW), null);
  });
});

describe("快照存储 · 写快照", () => {
  test("写一条只含分数、按小时分桶的记录", async () => {
    const cloud = makeCloud({});
    const store = createStore(cloud);
    await store.writeCurrent(group(), NOW);
    const doc = cloud.log.adds[0].data;
    assert.equal(doc._id, snap.bucketId(NOW));
    assert.equal(doc.at, NOW);
    assert.deepEqual(Object.keys(doc.plats).sort(), ["PC", "PS4"]);
    assert.deepEqual(Object.keys(doc.plats.PC), ["rp"]);
  });

  test("没有有效分数时什么都不写（不往库里塞空快照）", async () => {
    const cloud = makeCloud({});
    const store = createStore(cloud);
    await store.writeCurrent({ key: "RP", plats: [{ code: "PC", rp: null }] }, NOW);
    assert.equal(cloud.log.adds.length, 0);
  });

  test("同一个小时内重复写被主键挡掉 → 忽略，不抛", async () => {
    const store = createStore(makeCloud({ addThrows: true }));
    await assert.doesNotReject(() => store.writeCurrent(group(), NOW));
  });

  test("顺手清理 30 天前的老快照（库不能无限涨）", async () => {
    const cloud = makeCloud({});
    const store = createStore(cloud);
    await store.writeCurrent(group(), NOW);
    assert.equal(cloud.log.removes.length, 1);
    assert.equal(cloud.log.removes[0].q.at.op, "lt");
    assert.equal(cloud.log.removes[0].q.at.v, snap.pruneBefore(NOW));
  });

  test("清理失败不影响写入结果，也不抛", async () => {
    const cloud = makeCloud({ removeThrows: true });
    const store = createStore(cloud);
    await assert.doesNotReject(() => store.writeCurrent(group(), NOW));
    assert.equal(cloud.log.adds.length, 1, "写还是应该发生");
  });

  test("写入抛错时整个方法不抛（集合没建就是这个情形）", async () => {
    const store = createStore(makeCloud({ addThrows: true, removeThrows: true }));
    await assert.doesNotReject(() => store.writeCurrent(group(), NOW));
  });

  test("真错误要留下日志（静默失败最难查），但撞主键不刷日志", async () => {
    const logs = [];
    const real = console.warn, realLog = console.log;
    console.warn = (...a) => logs.push(a.join(" "));
    console.log = () => {};
    try {
      // 撞主键是预期内的重复写：两种真实写法都不该报 warn
      for (const dup of ["E11000 duplicate key error collection: x", "主键冲突", "_id 已存在"]) {
        await createStore(makeCloud({ addThrows: dup })).writeCurrent(group(), NOW);
      }
      assert.equal(logs.length, 0, "撞主键是正常情况，不该报 warn，实际：" + JSON.stringify(logs));

      // 真错误：必须留下痕迹
      await createStore(makeCloud({ getThrows: true })).readBasis(NOW);
      await createStore(makeCloud({ addThrows: "permission denied" })).writeCurrent(group(), NOW);
      assert.ok(logs.some((l) => /读猎杀底分基准失败/.test(l)), "读失败必须留日志，实际：" + JSON.stringify(logs));
      assert.ok(logs.some((l) => /permission denied/.test(l)), "写失败必须留日志并带上原因，实际：" + JSON.stringify(logs));
    } finally {
      console.warn = real; console.log = realLog;
    }
  });

  test("写入成功要留一条日志（这是「链路通了」的唯一直接证据）", async () => {
    const logs = [];
    const real = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      await createStore(makeCloud({})).writeCurrent(group(), NOW);
      assert.ok(logs.some((l) => /已记一条猎杀底分快照/.test(l)), "实际：" + JSON.stringify(logs));
    } finally {
      console.log = real;
    }
  });
});
