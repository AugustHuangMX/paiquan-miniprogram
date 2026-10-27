// 首页（2026-10-27 起第 1 个 tab）：utils/home.js 的纯函数 —— 问候语、挑大卡小卡、倒计时文字、赛事卡。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
const require = createRequire(import.meta.url);

const home = require(path.join(MP, "utils", "home.js"));
const vm = require(path.join(MP, "utils", "viewmodel.js"));
const nextmatch = require(path.join(MP, "utils", "nextmatch.js"));

const CJK = /[一-鿿　-〿＀-￯]/;
const ALL = ["pubs", "ranked", "wildcard", "mixtape"];

// 字段形状同 tests/page.test.mjs 的 rotationResult（照抄云函数真实返回）
const START = 1_800_000_000;
const raw = () => [
  { def: { id: "ranked", label: "排位赛地图", tag: "BR Ranked" }, current: { map: "Olympus", mapCn: "奥林匹斯", start: START, end: START + 3600, eventName: "" }, nexts: [{ map: "Broken Moon", mapCn: "残月", start: START + 3600, end: START + 7200, eventName: "" }] },
  { def: { id: "pubs", label: "匹配模式地图", tag: "BR Pubs" }, current: { map: "Broken Moon", mapCn: "残月", start: START, end: START + 1800, eventName: "" }, nexts: [{ map: "Olympus", mapCn: "奥林匹斯", start: START + 1800, end: START + 3600, eventName: "" }] },
  { def: { id: "mixtape", label: "轮换模式地图", tag: "Mixtape" }, current: { map: "Fragment", mapCn: "碎片", start: START, end: START + 900, eventName: "TDM" }, nexts: [] },
  { def: { id: "wildcard", label: "外卡模式地图", tag: "Wildcard" }, current: null, nexts: [] },
];

describe("首页 · utils/home.js", () => {
  test("问候语按手机上的时间分四段", () => {
    assert.equal(home.greeting(7, "zh"), "早上好");
    assert.equal(home.greeting(12, "zh"), "中午好");
    assert.equal(home.greeting(15, "zh"), "下午好");
    assert.equal(home.greeting(21, "zh"), "晚上好");
    assert.equal(home.greeting(3, "zh"), "晚上好", "半夜也是晚上好");
    assert.equal(home.greeting(7, "en"), "Good morning");
  });

  test("剩下多少时间：不足 1 分钟也说 1 分；一小时以上带小时", () => {
    assert.equal(home.remainText(20, "zh"), "1 分");
    assert.equal(home.remainText(9 * 60, "zh"), "9 分");
    assert.equal(home.remainText(65 * 60, "zh"), "1 小时 5 分");
    assert.equal(home.remainText(65 * 60, "en"), "1h 5m");
  });

  test("大卡是置顶的模式（默认排位），其余按 匹配 → 外卡 → 轮换 做小卡", () => {
    const modes = vm.buildModes(raw(), "zh");
    const p = home.pickModes(modes, ALL, "ranked");
    assert.equal(p.hero.id, "ranked");
    assert.deepEqual(p.smalls.map((m) => m.id), ["pubs", "wildcard", "mixtape"]);
    assert.equal(home.pickModes(modes, ALL, "pubs").hero.id, "pubs", "置顶匹配时大卡是匹配");
  });

  test("跟着「全部地图」⚙ 的设置：没勾选的模式不显示；置顶的没勾选时大卡取第一个开着的", () => {
    const modes = vm.buildModes(raw(), "zh");
    const p = home.pickModes(modes, ["pubs", "mixtape"], "ranked");
    assert.equal(p.hero.id, "pubs");
    assert.deepEqual(p.smalls.map((m) => m.id), ["mixtape"]);
    const off = home.pickModes(modes, ["wildcard"], "ranked");
    assert.equal(off.hero.id, "wildcard", "只剩没开的模式时也给一张卡（写着未开启），不留空");
    assert.equal(off.hero.active, false);
    assert.deepEqual(home.pickModes([], ALL, "ranked"), { hero: null, smalls: [] });
  });

  test("大卡：本场时段 + 接着哪张图；小卡标题带上轮换的玩法", () => {
    const modes = vm.buildModes(raw(), "zh");
    const p = home.pickModes(modes, ALL, "ranked");
    const hero = home.heroCard(p.hero, "zh");
    assert.equal(hero.map, "奥林匹斯");
    assert.equal(hero.label, "排位赛", "首页用短的模式名");
    assert.match(hero.sub, /^本场 .+ · 接着 残月$/);
    const mix = home.smallCard(p.smalls[2], "zh");
    assert.equal(mix.title, "轮换 · 团队死斗", "轮换没有地图照片，玩法必须写出来");
    const wild = home.smallCard(p.smalls[1], "zh");
    assert.equal(wild.active, false);
    assert.doesNotMatch(wild.title, / · /, "没开的外卡没有玩法可写");
  });

  test("每秒的字段：倒计时、进度、「9 分后 → 残月」；过了轮换时间标 overdue", () => {
    const modes = vm.buildModes(raw(), "zh");
    const hero = home.heroCard(home.pickModes(modes, ALL, "ranked").hero, "zh");
    const at = (sec) => (START + sec) * 1000;
    const f = home.tickFields(hero, at(3600 - 9 * 60), "zh");
    assert.equal(f.cd, "09:00", "和「全部地图」同一个格式（core.fmtDur）");
    assert.equal(f.soon, "9 分后 → 残月");
    assert.equal(f.pct, 85);
    assert.equal(f.urgent, false);
    assert.equal(home.tickFields(hero, at(3600 - 60), "zh").urgent, true, "最后 5 分钟变色");
    const late = home.tickFields(hero, at(3600 + 10), "zh");
    assert.equal(late.cd, "轮换中…");
    assert.equal(late.overdue, true);
    assert.equal(home.tickFields(home.heroCard(modes.find((m) => m.id === "wildcard"), "zh"), at(0), "zh"), null);
  });

  test("赛事卡：有下一场写时间；没有赛程时不显示", () => {
    const data = nextmatch.DATA;
    const nm = nextmatch.build("zh", 0, null, data);
    const card = home.esportsCard(nm, "zh");
    assert.ok(card.name, "赛事名不能空");
    assert.match(card.sub, /^下一场 /);
    assert.equal(home.esportsCard(null, "zh"), null);
  });

  test("英文模式：拼出来的文字里没有中文", () => {
    const modes = vm.buildModes(raw(), "en");
    const p = home.pickModes(modes, ALL, "ranked");
    const hero = home.heroCard(p.hero, "en");
    const f = home.tickFields(hero, (START + 3000) * 1000, "en");
    const text = JSON.stringify([hero.sub, hero.map, f, p.smalls.map((m) => home.smallCard(m, "en").title),
      home.esportsCard(nextmatch.build("en", 0, null, nextmatch.DATA), "en"), home.greeting(15, "en")]);
    assert.ok(!CJK.test(text), text);
  });
});
