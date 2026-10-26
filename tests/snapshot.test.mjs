// 快照逻辑（cloudfunctions/apex/snapshot.js）的测试。
//
// 为什么要自己存历史：上游 /predator 只给"当前值"，没有历史接口
// （实测 /predator/history 返回的就是当前值，说明那个路径被忽略了）。
// 所以"今天涨了多少"必须由我们自己按小时记快照再对比。
//
// 这一层的风险全在"对比错了"上：拿三天前的快照说"昨日涨幅"、
// 拿缺平台的快照硬减、把没有分数的空快照写进库 —— 都会给用户一个假数字。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.resolve(HERE, "..", "cloudfunctions", "apex", "snapshot.js");
if (!existsSync(SNAP)) throw new Error("缺少 " + SNAP + " —— 先写实现再跑");
const require = createRequire(import.meta.url);
const snap = require(SNAP);
const core = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "core.js"));

const H = 3600 * 1000;
const NOW = 1800000000000;
const group = (plats) => ({
  key: "RP",
  plats: plats || [
    { code: "PC", rp: 28685, updatedAt: NOW - 10 * 60 * 1000 },
    { code: "PS4", rp: 24000, updatedAt: NOW - 10 * 60 * 1000 },
  ],
});

describe("快照 · 分桶", () => {
  test("同一个小时内是同一个 id（一小时最多写一条）", () => {
    const a = snap.bucketId(NOW);
    const b = snap.bucketId(NOW + 59 * 60 * 1000);
    assert.equal(a, b);
  });

  test("跨小时就换 id", () => {
    assert.notEqual(snap.bucketId(NOW), snap.bucketId(NOW + H));
  });

  test("id 只含数字，能当数据库主键", () => {
    assert.match(snap.bucketId(NOW), /^h\d+$/);
  });
});

describe("快照 · 生成要写进库的文档", () => {
  test("正常：带上小时 id、当前时间、各平台分数", () => {
    const d = snap.snapshotOf(group(), NOW);
    assert.ok(d);
    assert.equal(d._id, snap.bucketId(NOW));
    assert.equal(d.at, NOW);
    assert.equal(d.plats.PC.rp, 28685);
    assert.equal(d.plats.PS4.rp, 24000);
  });

  test("只记分数 —— 人数那些字段对算涨幅没用，不占库", () => {
    const d = snap.snapshotOf(group([{ code: "PC", rp: 28685, masters: 4000, predCount: 750 }]), NOW);
    assert.deepEqual(Object.keys(d.plats.PC), ["rp"]);
  });

  test("没有分数的平台被跳过", () => {
    const d = snap.snapshotOf(group([
      { code: "PC", rp: 28685 },
      { code: "SWITCH", rp: null },
      { code: "X1", rp: 0 },
    ]), NOW);
    assert.deepEqual(Object.keys(d.plats), ["PC"]);
  });

  test("一条有效分数都没有时返回 null —— 不往库里塞空快照", () => {
    assert.equal(snap.snapshotOf(group([{ code: "PC", rp: null }]), NOW), null);
    assert.equal(snap.snapshotOf({ key: "RP", plats: [] }, NOW), null);
    assert.equal(snap.snapshotOf(null, NOW), null);
    assert.equal(snap.snapshotOf({ key: "RP" }, NOW), null);
  });

  test("时间是整数毫秒（数据库里别存浮点噪声）", () => {
    const d = snap.snapshotOf(group(), NOW + 0.7);
    assert.equal(d.at, Math.round(NOW + 0.7));
  });
});

describe("快照 · 挑基准（要对比哪一条）", () => {
  const docs = (ats) => ats.map((at) => ({ at: at, plats: { PC: { rp: 100 } } }));

  test("多条候选时挑最接近 24 小时前的那条", () => {
    const b = snap.pickBasis(docs([NOW - 21 * H, NOW - 23.5 * H, NOW - 26 * H]), NOW);
    assert.equal(b.at, NOW - 23.5 * H);
  });

  test("窗口外的候选（太近或太远）一律不要", () => {
    assert.equal(snap.pickBasis(docs([NOW - 3 * H, NOW - 19 * H]), NOW), null);
    assert.equal(snap.pickBasis(docs([NOW - 29 * H, NOW - 100 * H]), NOW), null);
  });

  test("窗口边界内的能用（20 小时和 28 小时都算）", () => {
    assert.ok(snap.pickBasis(docs([NOW - 20 * H]), NOW));
    assert.ok(snap.pickBasis(docs([NOW - 28 * H]), NOW));
    assert.equal(snap.pickBasis(docs([NOW - 20 * H + 1000]), NOW), null, "差一点不到 20 小时，算「太近」");
    assert.equal(snap.pickBasis(docs([NOW - 28 * H - 1000]), NOW), null, "差一点超过 28 小时，算「太远」");
  });

  test("结构坏掉的候选项跳过，不因此整条失败", () => {
    const mixed = [
      null, { at: "nope", plats: { PC: { rp: 1 } } }, { at: NOW - 24 * H },
      { at: NOW - 23 * H, plats: {} },
    ];
    const b = snap.pickBasis(mixed, NOW);
    assert.ok(b, "好的那条应当还能被挑出来");
    assert.equal(b.at, NOW - 23 * H);
  });

  test("候选为空/null/不是数组 → null（界面据此不显示涨幅）", () => {
    assert.equal(snap.pickBasis([], NOW), null);
    assert.equal(snap.pickBasis(null, NOW), null);
    assert.equal(snap.pickBasis("nope", NOW), null);
  });

  test("挑出来的基准直接能喂给 attachPredatorDeltas 用", () => {
    const g = core.normalizePredator({
      RP: {
        PC: { val: 28685, foundRank: 750 },
        PS4: { val: 24000, foundRank: 750 },
      },
    });
    const b = snap.pickBasis([{ at: NOW - 24 * H, plats: { PC: { rp: 27445 }, PS4: { rp: 24100 } } }], NOW);
    core.attachPredatorDeltas(g, b, NOW);
    assert.equal(g.plats.find((p) => p.code === "PC").delta, 1240);
    assert.equal(g.plats.find((p) => p.code === "PS4").delta, -100);
  });
});

describe("快照 · 清理", () => {
  test("只保留 30 天 —— 否则库会无限涨", () => {
    assert.equal(snap.pruneBefore(NOW), NOW - 30 * 24 * H);
  });
});
