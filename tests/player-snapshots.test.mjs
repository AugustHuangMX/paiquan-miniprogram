// 玩家排位快照（cloudfunctions/apex/playerSnapshots.js）的测试。
//
// 和猎杀底分快照同一套思路：按 (小时, uid) 记一条，第二天才有"较昨日"可比。
// 风险同样在"对比错了"上：拿窗口外的快照硬减、把没有分数的空快照写进库，
// 都会给用户一个假数字。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, "..", "cloudfunctions", "apex", "playerSnapshots.js");
if (!existsSync(MOD)) throw new Error("缺少 " + MOD + " —— 先写实现再跑");
const require = createRequire(import.meta.url);
const ps = require(MOD);

const H = 3600 * 1000;
const NOW = 1800000000000;

const player = (over = {}) => Object.assign({
  uid: "2262951949",
  name: "shroud",
  level: 255,
  rankName: "Diamond",
  rankDiv: 2,
  rankScore: 12345,
}, over);

describe("玩家快照 · 文档 id", () => {
  test("同一个 uid 同一个小时 id 相同（撞主键 = 天然去重）", () => {
    assert.equal(ps.bucketIdFor("2262951949", NOW), ps.bucketIdFor("2262951949", NOW + 59 * 60 * 1000));
  });

  test("不同 uid 或不同小时 id 不同", () => {
    assert.notEqual(ps.bucketIdFor("1", NOW), ps.bucketIdFor("2", NOW));
    assert.notEqual(ps.bucketIdFor("1", NOW), ps.bucketIdFor("1", NOW + H));
  });
});

describe("玩家快照 · snapshotOf", () => {
  test("有效玩家产出完整文档", () => {
    const d = ps.snapshotOf("2262951949", player(), NOW);
    assert.equal(d.uid, "2262951949");
    assert.equal(d.at, NOW);
    assert.equal(d.rp, 12345);
    assert.equal(d.rankName, "Diamond");
    assert.equal(d.rankDiv, 2);
    assert.equal(d.level, 255);
    assert.ok(d._id.includes("2262951949"), "id 要带 uid，否则不同玩家会互相覆盖");
  });

  test("没有分数（null）→ 不写空快照", () => {
    assert.equal(ps.snapshotOf("1", player({ rankScore: null }), NOW), null);
  });

  test("未定级（0 分）也是有效状态，照记", () => {
    const d = ps.snapshotOf("1", player({ rankScore: 0 }), NOW);
    assert.equal(d.rp, 0);
  });

  test("负分是脏数据 → 不写", () => {
    assert.equal(ps.snapshotOf("1", player({ rankScore: -5 }), NOW), null);
  });
});

describe("玩家快照 · pickBasis", () => {
  test("挑最接近 24 小时前、且落在 20~28h 窗口内的那条", () => {
    const docs = [
      { at: NOW - 26 * H, rp: 9000 },   // 距 24h 差 2h
      { at: NOW - 23 * H, rp: 10000 },  // 距 24h 差 1h → 更近
      { at: NOW - 2 * H, rp: 13000 },   // 太近，窗口外
    ];
    const b = ps.pickBasis(docs, NOW);
    assert.equal(b.at, NOW - 23 * H);
    assert.equal(b.rp, 10000);
  });

  test("没有落在窗口内的 → null（不硬减一个假数字）", () => {
    assert.equal(ps.pickBasis([{ at: NOW - 2 * H, rp: 1 }], NOW), null);
  });

  test("rp 非数字的候选直接跳过", () => {
    assert.equal(ps.pickBasis([{ at: NOW - 24 * H, rp: "abc" }], NOW), null);
  });

  test("空列表 → null", () => {
    assert.equal(ps.pickBasis([], NOW), null);
  });
});
