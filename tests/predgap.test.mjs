// 「距猎杀线还差多少分」的行为测试。
//
// 这一块的风险全在"数字会不会误导人"上：
//   · 分数线取不到时若退化成 0，会显示"还差 0 分"，比不显示糟糕得多；
//   · 已经上榜的人若走减法，会显示负数；
//   · 平台对不上时若拿别的平台分数线比，数字就是错的。
// 所以下面把"该不显示"的情形一条条钉住。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VM_PATH = path.resolve(HERE, "..", "miniprogram", "utils", "viewmodel.js");
if (!existsSync(VM_PATH)) {
  throw new Error("缺少 " + VM_PATH + " —— 先写实现再跑");
}
const require = createRequire(import.meta.url);
const vm = require(VM_PATH);

// 真实的 /predator 形态：PC 线 20728、猎杀 750 人、大师+猎杀 3652 人
const group = () => ({
  key: "RP",
  plats: [
    { code: "PC", label: "PC", rp: 20728, masters: 3652, predCount: 750 },
    { code: "PS4", label: "PlayStation", rp: 18099, masters: 3100, predCount: 749 },
    { code: "X1", label: "Xbox", rp: 17500, masters: 2900, predCount: 750 },
  ],
});

const player = (over) => Object.assign({ name: "Someone", platform: "PC", rankScore: 12340, ladderPos: null }, over || {});

describe("距猎杀线 · 差额计算", () => {
  test("没到线：给出正的差额", () => {
    const g = vm.predatorGap(player(), group(), "PC");
    assert.equal(g.kind, "below");
    assert.equal(g.need, 20728 - 12340);
    assert.ok(g.need > 0, "差额必须是正数");
    assert.equal(g.line, 20728);
    assert.equal(g.score, 12340);
  });

  test("差额永远为正：刚好压线算「已达到」而不是「还差 0 分」", () => {
    const g = vm.predatorGap(player({ rankScore: 20728 }), group(), "PC");
    assert.equal(g.kind, "above");
    assert.notEqual(g.kind, "below");
  });

  test("已经超过分数线：算「已达到」，绝不能出现负数差额", () => {
    const g = vm.predatorGap(player({ rankScore: 25000 }), group(), "PC");
    assert.equal(g.kind, "above");
    assert.equal(g.need, null, "这种情形下没有差额可言");
  });

  test("已在猎杀榜内：给名次，优先于分数线比较", () => {
    const g = vm.predatorGap(player({ rankScore: 30000, ladderPos: 137 }), group(), "PC");
    assert.equal(g.kind, "pred");
    assert.equal(g.rank, 137);
  });

  test("已在猎杀榜但分数线缺失：仍能显示名次（名次不依赖分数线）", () => {
    const g = vm.predatorGap(player({ ladderPos: 137 }), { key: "RP", plats: [{ code: "PC", label: "PC", rp: null }] }, "PC");
    assert.equal(g.kind, "pred");
    assert.equal(g.rank, 137);
    assert.equal(g.line, null);
  });
});

describe("距猎杀线 · 该不显示的情形一律返回 null", () => {
  test("分数线缺失 → null，而不是当成 0", () => {
    const g = vm.predatorGap(player(), { key: "RP", plats: [{ code: "PC", label: "PC", rp: null }] }, "PC");
    assert.equal(g, null);
  });

  test("平台对不上 → null，不能拿别的平台分数线硬算", () => {
    const g = vm.predatorGap(player({ platform: "SWITCH" }), group(), "SWITCH");
    assert.equal(g, null);
  });

  test("整个猎杀数据取不到 → null（上游超时时就是这个情形）", () => {
    assert.equal(vm.predatorGap(player(), null, "PC"), null);
    assert.equal(vm.predatorGap(player(), undefined, "PC"), null);
    assert.equal(vm.predatorGap(player(), { key: "RP", plats: [] }, "PC"), null);
  });

  test("玩家排位分数缺失且不在榜 → null，不显示「还差 X 分」", () => {
    assert.equal(vm.predatorGap(player({ rankScore: null }), group(), "PC"), null);
  });

  test("玩家对象本身缺失 → null（查无此人时）", () => {
    assert.equal(vm.predatorGap(null, group(), "PC"), null);
    assert.equal(vm.predatorGap(undefined, group(), "PC"), null);
  });

  test("分数线是 0 或负数这类脏数据 → null，不拿它比", () => {
    assert.equal(vm.predatorGap(player(), { key: "RP", plats: [{ code: "PC", label: "PC", rp: 0 }] }, "PC"), null);
    assert.equal(vm.predatorGap(player(), { key: "RP", plats: [{ code: "PC", label: "PC", rp: -5 }] }, "PC"), null);
  });

  test("这赛季没打排位的玩家（Unranked / 0 分）不显示差额", () => {
    // 真实数据里没打排位的人是 rankName=Unranked、rankScore=0。
    // 照减法算会说"还差 20,770 分"，读起来像 bug，而且没有起步就谈不上差距。
    assert.equal(vm.predatorGap(player({ rankName: "Unranked", rankDiv: 0, rankScore: 0 }), group(), "PC"), null);
    assert.equal(vm.buildPredGap(player({ rankName: "Unranked", rankDiv: 0, rankScore: 0 }), group(), "PC"), null);
  });

  test("分数是负数这种脏数据也不显示", () => {
    assert.equal(vm.predatorGap(player({ rankScore: -5 }), group(), "PC"), null);
  });

  test("已在榜内的人不受这条规则影响（名次优先）", () => {
    const g = vm.predatorGap(player({ rankScore: 0, ladderPos: 137 }), group(), "PC");
    assert.equal(g.kind, "pred", "在榜就该显示名次，跟分数是不是 0 无关");
  });
});

describe("距猎杀线 · 平台选择", () => {
  test("不传平台时用玩家自己的平台", () => {
    const g = vm.predatorGap(player({ platform: "PS4", rankScore: 1000 }), group(), undefined);
    assert.equal(g.line, 18099, "应取 PS4 的线");
  });

  test("每个平台各取各的线，不会串台", () => {
    assert.equal(vm.predatorGap(player(), group(), "PC").line, 20728);
    assert.equal(vm.predatorGap(player(), group(), "PS4").line, 18099);
    assert.equal(vm.predatorGap(player(), group(), "X1").line, 17500);
  });
});

describe("距猎杀线 · 界面文字", () => {
  test("未到线时给出差额、单位和分数线对照", () => {
    const v = vm.buildPredGap(player(), group(), "PC");
    assert.equal(v.kind, "below");
    assert.equal(v.title, "距猎杀线还差");
    assert.equal(v.value, "8,388", "千分位要加上，8388 这种数字读起来费劲");
    assert.equal(v.unit, "分");
    assert.ok(v.note.includes("20,728"), "要说清线是多少，实际：" + v.note);
    assert.ok(v.note.includes("12,340"), "也要说清他现在多少分，实际：" + v.note);
  });

  test("已在榜内时显示名次", () => {
    const v = vm.buildPredGap(player({ rankScore: 30000, ladderPos: 137 }), group(), "PC");
    assert.equal(v.kind, "pred");
    assert.equal(v.title, "已进入猎杀榜");
    assert.equal(v.value, "#137");
  });

  test("取不到数据时整块不显示（返回 null 而不是空对象）", () => {
    assert.equal(vm.buildPredGap(player(), null, "PC"), null);
    assert.equal(vm.buildPredGap(player({ rankScore: null }), group(), "PC"), null);
  });

  test("已在榜但拿不到分数线时，不编造一个分数线出来", () => {
    const v = vm.buildPredGap(player({ ladderPos: 137 }), { key: "RP", plats: [{ code: "PC", label: "PC", rp: null }] }, "PC");
    assert.equal(v.kind, "pred");
    assert.equal(v.note, "", "没有分数线就什么都不说");
  });
});
