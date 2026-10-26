// 视图模型（miniprogram/utils/viewmodel.js）的行为测试。
// 页面的 index.js 里会调用 Page({...})，在 Node 里没法直接 require，
// 所以把"把数据变成界面字段"这段纯逻辑拆出来单独测。
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
const core = require(path.resolve(HERE, "..", "miniprogram", "utils", "core.js"));

const rotation = () => ({
  battle_royale: { current: { start: 1000, end: 6400, map: "Broken Moon" }, next: { start: 6400, end: 11800, map: "World's Edge" } },
  ranked: { current: { start: 1000, end: 17200, map: "Olympus" }, next: { start: 17200, end: 33400, map: "Broken Moon" } },
  ltm: {
    current: { start: 1000, end: 1900, map: "Fragment", eventName: "TDM" },
    next: [
      { start: 1900, end: 2800, map: "Caustic Treatment", eventName: "Control" },
      { start: 2800, end: 3700, map: "Skulltown", eventName: "Gun Run" },
      { start: 3700, end: 4600, map: "Estates", eventName: "TDM" },
      { start: 4600, end: 5500, map: "Fragment", eventName: "TDM" },
    ],
  },
  wildcard: { current: { start: 1000, end: 6400, map: "E-District" }, next: { start: 6400, end: 11800, map: "Kings Canyon" } },
});

describe("视图模型 · 地图卡片", () => {
  test("四张卡片的标签与顺序（界面顺序：匹配 → 排位 → 外卡 → 轮换）", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    assert.equal(out.length, 4);
    assert.deepEqual([...out].map((m) => m.id), ["pubs", "ranked", "wildcard", "mixtape"]);
    assert.deepEqual([...out].map((m) => m.label), ["匹配模式地图", "排位赛地图", "外卡模式地图", "轮换模式地图"]);
  });

  test("认不出来的模式 id 排在最后，不会把已知模式挤乱", () => {
    const modes = core.normalizeRotation(rotation()).concat([
      { def: { id: "somethingnew", label: "新模式", tag: "New" }, current: null, nexts: [] },
    ]);
    const out = vm.buildModes(modes);
    assert.equal(out[out.length - 1].id, "somethingnew");
    assert.deepEqual(out.slice(0, 4).map((m) => m.id), ["pubs", "ranked", "wildcard", "mixtape"]);
  });

  test("大逃杀地图带本地配图；轮换的小区域图也有（用户在游戏里截的实景照）", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    const byId = {};
    out.forEach((m) => { byId[m.id] = m; });
    assert.match(byId.ranked.image, /^\/assets\/maps\/.+\.jpg$/, "排位用的是大逃杀图，应该有配图");
    assert.match(byId.pubs.image, /^\/assets\/maps\/.+\.jpg$/, "匹配同上");
    assert.match(byId.wildcard.image, /^\/assets\/maps\/.+\.jpg$/, "外卡也是大逃杀图，有配图");
    // 轮换的小区域图现在也有 —— 来源是用户自己截的图，不是第三方站点素材
    assert.match(byId.mixtape.image, /^\/assets\/maps\/mixtape-.*\.jpg$/, "轮换的小区域图要能配上");
  });

  test("有地图的卡片带地图名、玩法、时间段、剩余秒数", () => {
    const modes = core.normalizeRotation(rotation());
    const out = vm.buildModes(modes);
    const ranked = out.find((m) => m.id === "ranked");
    assert.equal(ranked.active, true);
    assert.equal(ranked.map, "奥林匹斯", "界面显示的应是中文名");
    assert.equal(ranked.mapEn, "Olympus", "英文原文要留着（配色按它算、查不到译名时兜底）");
    assert.equal(ranked.startSec, 1000);
    assert.equal(ranked.endSec, 17200);
    assert.ok(/\d\d:\d\d – \d\d:\d\d/.test(ranked.span), "时间段格式，实际：" + ranked.span);
    assert.equal(ranked.cd, "--:--", "初始占位，等 tick 填");
    assert.equal(ranked.pct, 0);
    const mixtape = out.find((m) => m.id === "mixtape");
    assert.equal(mixtape.eventName, "TDM");
  });

  test("查不到译名的地图就显示英文，绝不显示空白", () => {
    const raw = { ranked: { current: { start: 1, end: 2, map: "Brand New Map" }, next: null } };
    const out = vm.buildModes(core.normalizeRotation(raw));
    const ranked = out.find((m) => m.id === "ranked");
    assert.equal(ranked.map, "Brand New Map");
    assert.equal(ranked.mapEn, "Brand New Map");
    // 查不到译名的图自然也没有配图 —— 不能瞎配一张别的地图
    assert.equal(ranked.image, "", "认不出的地图名不能配图");
  });

  test("接着轮换那一列也要中文", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    const ranked = out.find((m) => m.id === "ranked");
    assert.equal(ranked.nexts[0].map, "残月");
  });

  test("配色按英文原名算（换语言不该让颜色变来变去）", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    const ranked = out.find((m) => m.id === "ranked");
    // Olympus 在 MAP_TINT 里是 #5b8dd6
    assert.equal(ranked.tint, core.MAP_TINT["Olympus"]);
  });

  test("每个模式有自己的配色，不同地图颜色不同", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    const colors = [...out].map((m) => m.tint);
    colors.forEach((c) => assert.ok(c && c.length > 0));
    assert.notEqual(colors[0], colors[1], "不同地图应当区分颜色");
  });

  test("面板未开启的模式 → active=false，且没有地图名", () => {
    const raw = rotation();
    delete raw.wildcard;
    const out = vm.buildModes(core.normalizeRotation(raw));
    const wc = out.find((m) => m.id === "wildcard");
    assert.equal(wc.active, false);
    assert.equal(wc.map, undefined);
    assert.deepEqual([...wc.nexts], []);
  });

  test("接着轮换最多显示 3 条，并带序号 key", () => {
    const out = vm.buildModes(core.normalizeRotation(rotation()));
    const mixtape = out.find((m) => m.id === "mixtape");
    assert.equal(mixtape.nexts.length, 3, "上游可能给很多条，界面只留 3 条");
    assert.deepEqual([...mixtape.nexts].map((n) => n.idx), [0, 1, 2]);
    assert.equal(mixtape.nexts[0].eventName, "Control");
    assert.ok(/\d\d:\d\d–\d\d:\d\d/.test(mixtape.nexts[0].span));
  });

  test("异常输入不抛异常", () => {
    for (const bad of [null, undefined, [], [{}]]) {
      assert.doesNotThrow(() => vm.buildModes(bad), JSON.stringify(bad));
    }
  });
});

describe("视图模型 · 猎杀底分涨幅与数据时间", () => {
  const H = 3600 * 1000;
  const NOW = 1800000000000;
  const withDelta = (over) => core.attachPredatorDeltas(
    core.normalizePredator({ RP: {
      PC: Object.assign({ val: 28685, foundRank: 750, totalMastersAndPreds: 4000, updateTimestamp: Math.round((NOW - 12 * 60 * 1000) / 1000) }, over || {}),
    } }),
    { at: NOW - 24 * H, plats: { PC: { rp: 27445 } } },
    NOW
  );

  test("涨了：带 + 号和千分位", () => {
    const [pc] = vm.buildPredator(withDelta(), NOW);
    assert.equal(pc.deltaText, "+1,240");
    assert.equal(pc.deltaUp, true);
  });

  test("跌了：带 − 号（赛季重置真会掉，不能藏）", () => {
    const g = core.attachPredatorDeltas(
      core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750, updateTimestamp: Math.round(NOW / 1000) } } }),
      { at: NOW - 24 * H, plats: { PC: { rp: 28685 } } },
      NOW
    );
    const [pc] = vm.buildPredator(g, NOW);
    assert.equal(pc.deltaText, "−8,685");
    assert.equal(pc.deltaUp, false);
  });

  test("一分没动时显示 ±0（这是真实测量到的 0，不是缺数据）", () => {
    const g = core.attachPredatorDeltas(
      core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750, updateTimestamp: Math.round(NOW / 1000) } } }),
      { at: NOW - 24 * H, plats: { PC: { rp: 20000 } } },
      NOW
    );
    const [pc] = vm.buildPredator(g, NOW);
    assert.equal(pc.deltaText, "±0");
  });

  test("没有基准时 deltaText 为空串 —— 界面据此整行不渲染", () => {
    const [pc] = vm.buildPredator(core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750 } } }), NOW);
    assert.equal(pc.deltaText, "");
    assert.equal(pc.deltaBasisText, "");
  });

  test("对比的是哪一条也要写出来（不然「涨了多少」没有参照）", () => {
    const [pc] = vm.buildPredator(withDelta(), NOW);
    assert.match(pc.deltaBasisText, /^较 \d\d-\d\d \d\d:\d\d$/, "实际：" + pc.deltaBasisText);
  });

  test("数据时间用上游的刷新时间，不是「刚刚」", () => {
    const [pc] = vm.buildPredator(withDelta(), NOW);
    assert.equal(pc.updatedAtText, "12 分钟前更新");
  });

  test("上游没给刷新时间时这一行也不显示（不编一个时间出来）", () => {
    const [pc] = vm.buildPredator(core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750 } } }), NOW);
    assert.equal(pc.updatedAtText, "");
  });

  test("没有传 now 时用当前时间兜底，也不抛", () => {
    assert.doesNotThrow(() => vm.buildPredator(withDelta()));
  });
});

describe("视图模型 · 猎杀榜", () => {
  test("数字带千分位，人数缺失时不显示该行", () => {
    const group = core.normalizePredator({
      RP: {
        PC: { foundRank: 750, val: 20661, totalMastersAndPreds: 3564 },
        SWITCH: { foundRank: -1, val: 16000, totalMastersAndPreds: 113 },
      },
    });
    const out = vm.buildPredator(group);
    const pc = out.find((p) => p.code === "PC");
    assert.equal(pc.rpText, "20,661");
    assert.equal(pc.predCountText, "750");
    assert.equal(pc.mastersText, "3,564");
    const sw = out.find((p) => p.code === "SWITCH");
    assert.equal(sw.predCountText, "", "foundRank=-1 不该显示成 0 人或 -1");
    assert.equal(sw.mastersText, "113");
  });

  test("没有数据时返回空数组而不是崩", () => {
    for (const bad of [null, undefined, {}]) {
      assert.deepEqual([...vm.buildPredator(bad)], []);
    }
  });
});

describe("视图模型 · 玩家", () => {
  test("猎杀玩家显示名次（默认中文：段位名也译成中文）", () => {
    const p = core.normalizePlayer({
      global: { name: "shroud", platform: "PC", level: 255, rank: { rankName: "Apex Predator", rankDiv: 0, rankScore: 21500, ladderPosPlatform: 137 } },
    });
    const out = vm.buildPlayer(p);
    assert.equal(out.name, "shroud");
    assert.equal(out.rankText, "猎杀者", "中文模式下不留英文段位名（否则页面上就是中英混排）");
    assert.equal(out.rankScoreText, "21,500");
    assert.equal(out.ladderText, "#137");
    assert.equal(out.levelText, " · 等级 255");
  });

  test("切到英文：段位名回落成上游原文", () => {
    const p = core.normalizePlayer({
      global: { name: "shroud", platform: "PC", level: 255, rank: { rankName: "Apex Predator", rankDiv: 0, rankScore: 21500, ladderPosPlatform: 137 } },
    });
    const out = vm.buildPlayer(p, "en");
    assert.equal(out.rankText, "Apex Predator");
    assert.equal(out.levelText, " \u00b7 level 255");
    assert.equal(out.seasonText, "");
  });

  test("未进榜显示「未进猎杀榜」而不是 -1", () => {
    const p = core.normalizePlayer({ global: { name: "x", platform: "PC", rank: { rankName: "Diamond", rankDiv: 2, rankScore: 12800, ladderPosPlatform: -1 } } });
    const out = vm.buildPlayer(p);
    assert.equal(out.ladderText, "未进猎杀榜");
    assert.equal(out.rankText, "钻石 2");
    assert.equal(out.rankScoreText, "12,800");
  });

  test("完全没排位数据时也不显示 null / undefined", () => {
    const out = vm.buildPlayer(core.normalizePlayer({ global: { name: "x" } }));
    assert.equal(out.rankScoreText, "—");
    assert.equal(out.rankText, "未定级 / 无排位数据");
    assert.equal(out.ladderText, "未进猎杀榜");
    assert.equal(out.levelText, "");
    assert.equal(out.seasonText, "");
  });

  test("赛季代号翻译成人话（上游给的是 br_ranked_s30_s2 这种）", () => {
    const out = vm.buildPlayer(core.normalizePlayer({
      global: { name: "x", rank: { rankName: "Diamond", rankScore: 1, rankedSeason: "br_ranked_s30_s2" } },
    }));
    assert.match(out.seasonText, /30/, "应带出赛季号");
    assert.match(out.seasonText, /2/, "应带出阶段号");
    assert.equal(/br_ranked/.test(out.seasonText), false, "不该把上游的原始代号直接甩给用户");
  });

  test("赛季代号认不出来时就不显示，别硬凑", () => {
    const out = vm.buildPlayer(core.normalizePlayer({
      global: { name: "x", rank: { rankName: "Diamond", rankScore: 1, rankedSeason: "weird_format" } },
    }));
    assert.equal(out.seasonText, "");
  });
});

/* ⚠️ 原来这里有一整个 describe「视图模型 · 战绩页」（8 条：等级/威望、在线状态、当前传奇、
   封禁、生涯数据、缺字段兜底、与猎杀榜页写法一致）。
   2026-10-16 用户要求把第 4 个 tab 从「战绩」换成「猜圈」小游戏，战绩页整页删除，
   vm.buildStats 也一起删了 —— 没有消费者的纯函数不该留在代码里。
   排位专区页用的是 vm.buildPlayer，它的用例在上面那一节，覆盖还在。 */

describe("视图模型 · 错误展示", () => {
  const kinds = ["nokey", "badkey", "unverified", "internal", "network", "timeout", "ratelimit", "empty", "http"];
  test("每种失败都有自己的标题，不能都长一样", () => {
    const titles = kinds.map((k) => vm.errView(k, "x").title);
    titles.forEach((t) => assert.ok(t && t.length > 0, "每种 kind 都要有标题"));
    assert.equal(new Set(titles).size, titles.length, "标题必须互不相同，否则用户分不清问题出在哪");
  });

  test("Key 类问题用 err 样式，网络/限流类用 warn", () => {
    assert.equal(vm.errView("badkey", "x").style, "err");
    assert.equal(vm.errView("unverified", "x").style, "err");
    assert.equal(vm.errView("nokey", "x").style, "err");
    assert.equal(vm.errView("network", "x").style, "warn");
    assert.equal(vm.errView("ratelimit", "x").style, "warn");
  });

  test("不认识的 kind 有兜底，不透出空标题", () => {
    const out = vm.errView("something_new", "出问题了");
    assert.ok(out.title && out.title.length > 0);
    assert.equal(out.style, "warn");
    assert.equal(out.kind, "something_new");
  });

  test("原样带回 message，并把 kind 透给界面（未激活时界面要额外显示验证入口）", () => {
    const out = vm.errView("unverified", core.MSG.unverified);
    assert.equal(out.kind, "unverified");
    assert.ok(/discord-auth/.test(out.message), "未激活的提示里必须带验证链接");
  });
});
