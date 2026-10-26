// 轮盘（miniprogram/utils/wheel_data.js）的单元测试。
//
// 这个模块不联网、不碰页面，所以在这里把"数据对不对、抽签对不对、扇形算得对不对"
// 全部钉死 —— 页面那边（tests/page.test.mjs）只看交互，看不到这些。
//
// 三条最容易静默出错的地方：
//   1. 候选池漏了一件东西（比如新加的枪没标枪种）→ 那把枪永远抽不到，界面上看不出来；
//   2. 英雄头像路径写错 → 结果卡片上是一块空白，只有真机才看得见；
//   3. 扇形角度算错一点 → 指针指的那一片和真正中奖的那一片不是同一个，
//      而且"看起来没问题"（两片颜色一样）。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
const require = createRequire(import.meta.url);
const wd = require(path.join(MP, "utils", "wheel_data.js"));

describe("轮盘 · 候选池", () => {
  test("英雄池：id 不重复、中英文名都有、头像文件真实存在", () => {
    const heroes = wd.heroes();
    assert.ok(heroes.length >= 20, "英雄池太小了，实际 " + heroes.length);

    const ids = heroes.map((h) => h.id);
    assert.deepEqual([...new Set(ids)], ids, "英雄 id 有重复");

    const missing = heroes.filter((h) => !h.zh || !h.en || !h.icon).map((h) => h.id);
    assert.deepEqual(missing, [], "这些英雄缺名字或头像路径：" + missing.join(", "));

    // 头像必须是**包内**文件（写成网络地址在小程序里根本加载不出来，还会被审核问）
    const noFile = heroes.filter((h) => {
      if (!h.icon.startsWith("/assets/heroes/")) return true;
      return !existsSync(path.join(MP, h.icon.replace(/^\//, "")));
    }).map((h) => h.id + " → " + h.icon);
    assert.deepEqual(noFile, [], "这些英雄的头像不在包里：" + noFile.join(", "));
  });

  test("武器池：投掷刀不算枪，每一把都标了枪种（漏标 = 永远抽不到，界面上看不出来）", () => {
    const guns = wd.weapons();
    const ids = guns.map((w) => w.id);
    assert.equal(ids.includes("throwknife"), false, "投掷刀不是枪，不该进轮盘");
    assert.deepEqual([...new Set(ids)], ids, "武器 id 有重复");
    assert.ok(guns.length >= 20, "枪械池太小了，实际 " + guns.length);

    const bad = guns.filter((w) => !wd.CLASSES[w.cls] || !w.side || !w.shortZh || !w.shortEn);
    assert.deepEqual(bad.map((w) => w.id), [], "这些枪缺枪种或短标签");
    assert.deepEqual(guns.filter((w) => w.side !== "long" && w.side !== "short").map((w) => w.id), []);
  });

  test("长枪 / 短枪两个池子都够抽，且加起来就是全部枪", () => {
    const long = wd.bySide("long");
    const short = wd.bySide("short");
    assert.ok(long.length >= 4, "长枪池太小：" + long.length);
    assert.ok(short.length >= 4, "短枪池太小：" + short.length);
    assert.equal(long.length + short.length, wd.weapons().length);

    // 口径写死一遍：长枪 = 步枪/机枪/精确射手/狙击，短枪 = 冲锋枪/霰弹枪/手枪
    const longCls = new Set(long.map((w) => w.cls));
    const shortCls = new Set(short.map((w) => w.cls));
    assert.deepEqual([...longCls].sort(), ["ar", "lmg", "marksman", "sniper"]);
    assert.deepEqual([...shortCls].sort(), ["pistol", "shotgun", "smg"]);
  });

  test("轮盘上的短标签够短（径向排字，一片只有五十来 rpx）", () => {
    const tooLong = wd.weapons().filter((w) => w.shortZh.length > 8 || w.shortEn.length > 10);
    assert.deepEqual(tooLong.map((w) => w.id), [], "这些短标签太长，会压到隔壁扇形");
  });

  test("stats() 和池子对得上（界面上的「28 位英雄 / 29 把枪」就是这里来的）", () => {
    const s = wd.stats();
    assert.equal(s.heroes, wd.heroes().length);
    assert.equal(s.weapons, wd.weapons().length);
    assert.equal(s.long + s.short, s.weapons);
  });
});

describe("轮盘 · 抽签", () => {
  const ids = (list) => list.map((x) => x.id);

  test("英雄：抽 1 位就是 1 位，抽 3 位就是 3 位不重复", () => {
    assert.equal(wd.drawHeroes(1).length, 1);
    for (let k = 0; k < 30; k++) {
      const three = entries(wd.drawHeroes(3));
      assert.equal(three.length, 3);
      assert.equal(new Set(three.map((x) => x.key)).size, 3, "三人组合不能重样");
    }
  });

  test("武器 · 一长一短：一把长枪 + 一把短枪，顺序固定是长、短", () => {
    for (let k = 0; k < 30; k++) {
      const pair = wd.drawWeapons("pair");
      assert.equal(pair.length, 2);
      assert.equal(pair[0].side, "long");
      assert.equal(pair[1].side, "short");
      assert.notEqual(pair[0].id, pair[1].id);
    }
  });

  test("武器 · 两把随机：两把不重复（同枪种是允许的）", () => {
    for (let k = 0; k < 30; k++) {
      const two = wd.drawWeapons("any");
      assert.equal(two.length, 2);
      assert.notEqual(two[0].id, two[1].id);
    }
  });

  test("随机源可以注入（测试要可复现，所以不能直接写死 Math.random 的调用点）", () => {
    const zero = () => 0;
    assert.deepEqual(ids(wd.drawHeroes(3, zero)), ids(wd.heroes().slice(0, 3)));
    // 0 永远落在第 0 个 —— pair 模式就是"第一把长枪 + 第一把短枪"
    assert.deepEqual(ids(wd.drawWeapons("pair", zero)), [
      wd.bySide("long")[0].id,
      wd.bySide("short")[0].id
    ]);
    // 1 也不能越界（Math.random() 取不到 1，但注入的假随机可能是 1）
    assert.equal(wd.drawWeapons("any", () => 1).length, 2);
  });

  test("抽很多次，池子里每一件都抽得到（没有哪个被漏掉）", () => {
    const seen = new Set();
    for (let k = 0; k < 600; k++) ids(wd.drawHeroes(3)).forEach((id) => seen.add(id));
    assert.equal(seen.size, wd.heroes().length, "有英雄一次都抽不到");

    const guns = new Set();
    for (let k = 0; k < 600; k++) ids(wd.drawWeapons("any")).forEach((id) => guns.add(id));
    assert.equal(guns.size, wd.weapons().length, "有枪一次都抽不到");
  });

  test("draw() 按玩法分派：kind + mode 的组合都能出结果", () => {
    assert.equal(wd.draw("hero", "one").length, 1);
    assert.equal(wd.draw("hero", "triple").length, 3);
    assert.equal(wd.draw("weapon", "pair").length, 2);
    assert.equal(wd.draw("weapon", "any").length, 2);
  });
});

describe("轮盘 · 扇形几何", () => {
  test("片数 = 候选数，每一片都是从圆心出发的闭合多边形", () => {
    const segs = wd.layout(29, 0.8);
    assert.equal(segs.length, 29);
    segs.forEach((s) => {
      assert.match(s.clip, /^polygon\(50% 50%, /);
      assert.match(s.clip, /\)$/);
      assert.equal(s.i, segs.indexOf(s));
    });
    // 只有一片（理论上不会出现，但别崩）
    assert.equal(wd.layout(1).length, 1);
    assert.equal(wd.layout(0).length, 1);
  });

  test("clip-path 里只有百分比，没有 rpx（rpx 会被编译期替换搞坏）", () => {
    // 依据：docs/design/README.md「clip-path 里禁用 rpx」
    const bad = wd.layout(28, 0.76).filter((s) => /rpx|px\b/.test(s.clip));
    assert.deepEqual(bad, [], "扇形里出现了 rpx/px，会被编译期改坏");
    // 坐标必须落在 0~100%（否则扇形会跑出圆外）
    const nums = wd.layout(28, 0.76).flatMap((s) => [...s.clip.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1])));
    assert.ok(nums.every((v) => v >= 0 && v <= 100), "扇形坐标越界了");
  });

  test("中线等分 360°，标签都在圆内", () => {
    const n = 28;
    const step = 360 / n;
    for (let i = 0; i < n; i++) {
      const mid = wd.midAngle(i, n);
      assert.ok(Math.abs(mid - (i * step + step / 2)) < 1e-9);
    }
    const spots = wd.layout(n, 0.76);
    spots.forEach((s) => {
      assert.ok(s.lx >= 0 && s.lx <= 100 && s.ly >= 0 && s.ly <= 100);
      // 标签离圆心 0.76R：不能压到中间的按钮（按钮半径约 0.15R）
      const dist = Math.hypot(s.lx - 50, s.ly - 50) / 50;
      assert.ok(Math.abs(dist - 0.76) < 0.02, "标签不在预期半径上：" + dist);
    });
  });

  test("angleFor 和 midAngle 互补：转到那个角度，指针正好压在第 i 片的中线上", () => {
    for (const n of [1, 2, 4, 28, 29]) {
      for (let i = 0; i < n; i++) {
        const at = (wd.angleFor(i, n) + wd.midAngle(i, n)) % 360;
        // angleFor 只保留两位小数（style 里不需要更高精度），所以容差按 0.05° 给
        assert.ok(at < 0.05 || at > 360 - 0.05, "n=" + n + " i=" + i + " 偏了 " + at + "°");
      }
    }
  });
});

/* 把候选池条目变成 {key} 数组 —— 英雄和枪都只关心"不重复"，不关心是什么 */
function entries(list) {
  return list.map((x) => ({ key: x.id }));
}
