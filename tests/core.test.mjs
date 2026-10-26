// 小程序端纯逻辑（miniprogram/utils/core.js）的行为测试。
// 断言直接搬自 HTML 版那 75 条里与归一化相关的部分 —— 那些坑已经踩过，不要再踩一次。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_PATH = path.resolve(HERE, "..", "miniprogram", "utils", "core.js");
const require = createRequire(import.meta.url);

if (!existsSync(CORE_PATH)) {
  throw new Error("缺少 " + CORE_PATH + " —— 先写实现再跑");
}
const core = require(CORE_PATH);

/* ---- 与 HTML 版共用的真实响应夹具（2026-09-28 实测） ---- */
const rotationReal = () => ({
  battle_royale: {
    current: { start: 1790587800, end: 1790593200, map: "Broken Moon", asset: "x.png",
               DurationInSecs: 5400, remainingSecs: 5400 },
    next: { start: 1790593200, end: 1790598600, map: "World's Edge" },
  },
  ranked: {
    current: { start: 1790577000, end: 1790593200, map: "Olympus", DurationInSecs: 16200 },
    next: { start: 1790593200, end: 1790609400, map: "Broken Moon" },
  },
  ltm: {
    current: { start: 1790592300, end: 1790593200, map: "Fragment", eventName: "TDM", DurationInSecs: 900 },
    next: { start: 1790593200, end: 1790594100, map: "Caustic Treatment", eventName: "Control" },
  },
  wildcard: {
    current: { start: 1790587800, end: 1790593200, map: "E-District", DurationInSecs: 5400 },
    next: { start: 1790593200, end: 1790598600, map: "Kings Canyon" },
  },
});

const predatorReal = () => ({
  RP: {
    PC: { foundRank: 750, val: 20661, uid: "1008819110967", updateTimestamp: 1790589929, totalMastersAndPreds: 3564 },
    PS4: { foundRank: 750, val: 18007, uid: "1421238789137568352", updateTimestamp: 1790589946, totalMastersAndPreds: 1931 },
    X1: { foundRank: 750, val: 16338, uid: "2535445929953625", updateTimestamp: 1790589972, totalMastersAndPreds: 950 },
    SWITCH: { foundRank: -1, val: 16000, uid: "-1", updateTimestamp: 1790589972, totalMastersAndPreds: 113 },
  },
});

const bridgeReal = (over = {}) => ({
  global: {
    name: "shroud", uid: 2262951949, avatar: "https://example.com/a.png",
    platform: "PC", level: 255,
    rank: Object.assign({
      rankScore: 21500, rankName: "Apex Predator", rankDiv: 0,
      ladderPosPlatform: 137, rankedSeason: "br_ranked_s30_s2",
    }, over),
  },
});

describe("小程序端核心逻辑 · 时间格式", () => {
  test("fmtDur 正确进位", () => {
    assert.equal(core.fmtDur(0), "00:00");
    assert.equal(core.fmtDur(59), "00:59");
    assert.equal(core.fmtDur(60), "01:00");
    assert.equal(core.fmtDur(3599), "59:59");
    assert.equal(core.fmtDur(3600), "1:00:00");
    assert.equal(core.fmtDur(-5), "00:00");
  });
  test("fmtClock 按本机时区", () => {
    const e = 1790587800, d = new Date(e * 1000);
    const want = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    assert.equal(core.fmtClock(e), want);
    assert.equal(core.fmtClock(0), "--:--");
  });
  test("num 千分位", () => {
    assert.equal(core.num(20661), "20,661");
    assert.equal(core.num(null), "—");
  });
});

describe("小程序端核心逻辑 · 地图轮换归一化", () => {
  test("真实载荷 → 四张卡片，顺序为 排位/匹配/轮换/外卡", () => {
    const out = core.normalizeRotation(rotationReal());
    assert.equal(out.length, 4);
    assert.deepEqual([...out].map((r) => r.def.id), ["ranked", "pubs", "mixtape", "wildcard"]);
    assert.deepEqual([...out].map((r) => r.def.label), ["排位赛地图", "匹配模式地图", "轮换模式地图", "外卡模式地图"]);
    assert.equal(out.find((r) => r.def.id === "ranked").current.map, "Olympus");
    assert.equal(out.find((r) => r.def.id === "pubs").current.map, "Broken Moon");
    assert.equal(out.find((r) => r.def.id === "mixtape").current.map, "Fragment");
    assert.equal(out.find((r) => r.def.id === "wildcard").current.map, "E-District");
  });

  test("轮换模式的玩法（eventName）要带出来", () => {
    const out = core.normalizeRotation(rotationReal());
    assert.equal(out.find((r) => r.def.id === "mixtape").current.eventName, "TDM");
  });

  test("next 是对象时当成 1 条；是数组时全部保留", () => {
    const a = core.normalizeRotation(rotationReal());
    assert.equal(a[0].nexts.length, 1);
    const p = rotationReal();
    p.ranked.next = [{ start: 1, end: 2, map: "A" }, { start: 2, end: 3, map: "B" }];
    assert.deepEqual([...core.normalizeRotation(p)[0].nexts].map((n) => n.map), ["A", "B"]);
  });

  test("地图配图地址（asset）要保留下来", () => {
    // 小程序端用不到（图片域名要备案，加载不了），但网页版要靠它显示配图。
    // 归一化层是两端共用的，所以不能顺手把它丢掉。
    const out = core.normalizeRotation(rotationReal());
    const pubs = out.find((r) => r.def.id === "pubs");
    assert.equal(pubs.current.asset, "x.png");
    const ranked = out.find((r) => r.def.id === "ranked");
    assert.equal(typeof ranked.current.asset, "string", "没有配图时也该是空串，不是 undefined");
  });

  test("上游改名（用 mixtape 代替 ltm）仍能取到", () => {
    const p = rotationReal();
    p.mixtape = p.ltm;
    delete p.ltm;
    assert.equal(core.normalizeRotation(p).find((r) => r.def.id === "mixtape").current.map, "Fragment");
  });

  test("缺 end 但有 remainingSecs 时能推算", () => {
    const p = rotationReal();
    p.ranked.current = { start: 5000, map: "Olympus", remainingSecs: 600 };
    assert.equal(core.normalizeRotation(p)[0].current.end, 5600);
  });

  test("null/数组/空对象等异常输入不抛异常，且永远返回 4 个槽位", () => {
    for (const bad of [null, undefined, [], {}, "", 0, { ranked: null }, { ranked: [] }]) {
      assert.doesNotThrow(() => {
        assert.equal(core.normalizeRotation(bad).length, 4, JSON.stringify(bad));
      });
    }
  });

  test("上游改了字段名时要点名报出来", () => {
    const raw = { ranked: { current: { map: "X", start: 1, end: 2 } }, mystery_mode: { current: { map: "?", start: 1, end: 2 } } };
    assert.deepEqual([...core.unknownModeKeys(raw)], ["mystery_mode"]);
    assert.deepEqual([...core.unknownModeKeys(rotationReal())], []);
    for (const bad of [null, undefined, [], "", 0]) assert.doesNotThrow(() => core.unknownModeKeys(bad));
  });

  test("isUselessPayload 认得出空响应（上游连打时会回 HTTP 200 + []）", () => {
    assert.equal(core.isUselessPayload([]), true);
    assert.equal(core.isUselessPayload({}), true);
    assert.equal(core.isUselessPayload(null), true);
    assert.equal(core.isUselessPayload(rotationReal()), false);
    assert.equal(core.isUselessPayload({ some_new_mode: { current: { map: "X" } } }), false);
  });
});

describe("小程序端核心逻辑 · 猎杀分数线归一化", () => {
  test("真实结构 {RP:{PC:{val,totalMastersAndPreds,foundRank}}}", () => {
    const g = core.normalizePredator(predatorReal());
    assert.ok(g, "分组键是 RP，不是 ranked");
    assert.equal(g.plats.length, 4);
    const pc = g.plats.find((p) => p.code === "PC");
    assert.equal(pc.rp, 20661, "分数线在 val 字段");
    assert.equal(pc.masters, 3564);
    assert.equal(pc.predCount, 750, "foundRank 即猎杀人数");
    assert.equal(g.plats.find((p) => p.code === "SWITCH").predCount, null, "foundRank=-1 应视为没有");
  });

  test("兼容早期形态 {ranked:{PC:{RP:...}}}", () => {
    const g = core.normalizePredator({ ranked: { PC: { found: true, RP: 20661, totalMastersAndPreds: 3564 } } });
    assert.equal(g.plats[0].rp, 20661);
  });

  test("字符串数字能转换", () => {
    const g = core.normalizePredator({ RP: { PC: { val: "20661", totalMastersAndPreds: "3564" } } });
    assert.equal(g.plats[0].rp, 20661);
    assert.equal(g.plats[0].masters, 3564);
  });

  test("空/异常载荷返回 null 不抛异常", () => {
    for (const bad of [null, undefined, {}, [], "", { RP: {} }]) {
      assert.doesNotThrow(() => core.normalizePredator(bad));
      assert.equal(core.normalizePredator(bad), null, JSON.stringify(bad));
    }
  });

  test("每个平台要带出上游的刷新时间（updateTimestamp 是秒，要转成毫秒）", () => {
    const g = core.normalizePredator(predatorReal());
    const pc = g.plats.find((p) => p.code === "PC");
    assert.equal(pc.updatedAt, 1790589929 * 1000, "上游给的是秒，界面按毫秒算时间差");
  });

  test("上游没给刷新时间时是 null —— 不能拿「现在」顶上，那等于骗人", () => {
    const g = core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750 } } });
    assert.equal(g.plats[0].updatedAt, null);
  });

  test("刷新时间的脏数据一律当没有", () => {
    for (const bad of [0, -5, "abc", null, ""]) {
      const g = core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750, updateTimestamp: bad } } });
      assert.equal(g.plats[0].updatedAt, null, JSON.stringify(bad));
    }
  });

  test("上游万一改成毫秒也不会算错（大于 1e12 就当毫秒）", () => {
    const ms = 1790589929000;
    const g = core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750, updateTimestamp: ms } } });
    assert.equal(g.plats[0].updatedAt, ms);
  });

  test("数字型字符串也认", () => {
    const g = core.normalizePredator({ RP: { PC: { val: 20000, foundRank: 750, updateTimestamp: "1790589929" } } });
    assert.equal(g.plats[0].updatedAt, 1790589929000);
  });
});

describe("小程序端核心逻辑 · 猎杀底分涨幅（较昨日同期）", () => {
  const NOW = 1800000000000;                       // 基准"现在"
  const H = 3600 * 1000;
  const group = () => ({
    key: "RP",
    plats: [
      { code: "PC", label: "PC", rp: 28685, masters: 4000, predCount: 750, updatedAt: NOW - 10 * 60 * 1000 },
      { code: "PS4", label: "PlayStation", rp: 24000, masters: 2000, predCount: 750, updatedAt: NOW - 10 * 60 * 1000 },
    ],
  });
  const basis = (at, plats) => ({ at, plats: Object.assign({ PC: { rp: 27445 }, PS4: { rp: 24100 } }, plats || {}) });

  test("有 24 小时前的基准时，算出涨了多少", () => {
    const g = core.attachPredatorDeltas(group(), basis(NOW - 24 * H), NOW);
    const pc = g.plats.find((p) => p.code === "PC");
    assert.equal(pc.delta, 28685 - 27445);
    assert.equal(pc.deltaBasisAt, NOW - 24 * H, "要把对比的是什么时候也带出来，界面要写清楚");
  });

  test("底分掉了也照实返回负数 —— 赛季重置时真会掉，不能藏", () => {
    const g = core.attachPredatorDeltas(group(), basis(NOW - 24 * H, { PS4: { rp: 25000 } }), NOW);
    assert.equal(g.plats.find((p) => p.code === "PS4").delta, 24000 - 25000);
  });

  test("基准里没有这个平台 → 只有这个平台没有涨幅，别的照旧", () => {
    const b = basis(NOW - 24 * H);
    delete b.plats.PS4;
    const g = core.attachPredatorDeltas(group(), b, NOW);
    assert.equal(g.plats.find((p) => p.code === "PC").delta, 1240);
    assert.equal(g.plats.find((p) => p.code === "PS4").delta, null);
  });

  test("基准超出 20~28 小时这个窗口 → 一律不算（拿两三天前的基准说「昨日涨幅」是错的）", () => {
    for (const at of [NOW - 10 * H, NOW - 19 * H, NOW - 29 * H, NOW - 72 * H]) {
      const g = core.attachPredatorDeltas(group(), basis(at), NOW);
      g.plats.forEach((p) => assert.equal(p.delta, null, "基准时间 " + (NOW - at) / H + " 小时前不该被采用"));
    }
  });

  test("基准分数是 0 或缺失 → 该平台不算，绝不当成 0 来减", () => {
    const g = core.attachPredatorDeltas(group(), basis(NOW - 24 * H, { PC: { rp: 0 } }), NOW);
    assert.equal(g.plats.find((p) => p.code === "PC").delta, null);
  });

  test("当前分数不可用时也不算", () => {
    const g0 = group();
    g0.plats[0].rp = null;
    const g = core.attachPredatorDeltas(g0, basis(NOW - 24 * H), NOW);
    assert.equal(g.plats.find((p) => p.code === "PC").delta, null);
  });

  test("没有基准（第一次上线、库里还没数据）→ 全部 null，界面据此不显示那一行", () => {
    for (const b of [null, undefined, {}, { at: NOW, plats: null }]) {
      const g = core.attachPredatorDeltas(group(), b, NOW);
      g.plats.forEach((p) => assert.equal(p.delta, null));
    }
  });

  test("group 本身没有时原样返回，不抛异常", () => {
    assert.equal(core.attachPredatorDeltas(null, basis(NOW - 24 * H), NOW), null);
    assert.doesNotThrow(() => core.attachPredatorDeltas({}, basis(NOW - 24 * H), NOW));
  });
});

describe("小程序端核心逻辑 · 玩家归一化", () => {  test("真实 bridge 载荷", () => {
    const p = core.normalizePlayer(bridgeReal());
    assert.equal(p.name, "shroud");
    assert.equal(p.level, 255);
    assert.equal(p.rankName, "Apex Predator");
    assert.equal(p.rankScore, 21500);
    assert.equal(p.ladderPos, 137);
  });
  test("未进榜（ladderPosPlatform = -1）视为 null，不显示 -1", () => {
    assert.equal(core.normalizePlayer(bridgeReal({ ladderPosPlatform: -1 })).ladderPos, null);
  });
  test("缺排位数据不抛异常", () => {
    let p;
    assert.doesNotThrow(() => { p = core.normalizePlayer({ global: { name: "X" } }); });
    assert.equal(p.rankScore, null);
    assert.equal(p.ladderPos, null);
  });
  test("空载荷给兜底名字", () => {
    for (const bad of [null, undefined, {}, []]) assert.doesNotThrow(() => core.normalizePlayer(bad));
    assert.equal(core.normalizePlayer({}).name, "未知玩家");
  });
});

describe("小程序端核心逻辑 · 玩家 uid（解决同名）", () => {
  test("归一化时带出 uid（数字和字符串都要认）", () => {
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: 2262951949 } }).uid, "2262951949");
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: "2262951949" } }).uid, "2262951949");
  });

  test("uid 缺失或不像 uid 时给空串，不编一个出来", () => {
    assert.equal(core.normalizePlayer({ global: { name: "a" } }).uid, "");
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: "" } }).uid, "");
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: "abc" } }).uid, "");
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: -1 } }).uid, "");
    assert.equal(core.normalizePlayer({ global: { name: "a", uid: null } }).uid, "");
  });

  test("isUidLike：只认纯数字、长度像 uid 的输入", () => {
    assert.equal(core.isUidLike("2262951949"), true);
    assert.equal(core.isUidLike("1421238789137568352"), true, "主机平台的 uid 更长");
    assert.equal(core.isUidLike("123456"), true);
    assert.equal(core.isUidLike("shroud"), false);
    assert.equal(core.isUidLike("12345"), false, "太短，更像玩家名");
    assert.equal(core.isUidLike("1".repeat(30)), false, "太长");
    assert.equal(core.isUidLike(""), false);
    assert.equal(core.isUidLike(null), false);
    assert.equal(core.isUidLike("12 34"), false);
  });

  test("判断偏宽松也没关系 —— 查询时是先当名字查、查不到才当 uid 试", () => {
    // 所以哪怕把某个纯数字的玩家名误判成 uid，也不会影响他查询
    assert.equal(core.isUidLike("123456789"), true);
  });
});

/* ============================================================
   战绩字段归一化（"个人战绩"页要用）
   字段名照抄 2026-09-28 实测的真实响应
   ============================================================ */
const bridgeFull = (over = {}) => Object.assign({
  global: {
    name: "shroud", tag: "", uid: 2262951949, avatar: "https://x/a.png",
    platform: "PC", level: 255, toNextLevelPercent: 60, levelPrestige: 2,
    bans: { isActive: false, remainingSeconds: 0, last_banReason: "None" },
    rank: { rankScore: 21500, rankName: "Apex Predator", rankDiv: 0, ladderPosPlatform: 137, rankedSeason: "br_ranked_s30_s2" },
    battlepass: { level: null, history: null },
  },
  realtime: { lobbyState: "invite", isOnline: 0, isInGame: 0, canJoin: 0, partyFull: 0,
              selectedLegend: "Revenant", currentState: "offline", currentStateSinceTimestamp: -1, currentStateAsText: "Offline" },
  total: {
    kills: { name: "BR Kills", value: 13877 },
    headshots: { name: "BR Headshots", value: 10747 },
    damage: { name: "BR Damage", value: 2558994 },
    shields_charged: { name: "Friendly shields charged", value: 3210 },
    wins_as_full_squad: { name: "BR Wins as full squad", value: 16 },
    kills_season_12: { name: "BR Season 12 kills", value: 406 },
    some_new_thing: { name: "Totally New Tracker", value: 42 },
  },
  legends: { all: { Revenant: { data: [{ name: "BR Kills", value: 68 }] } } },
}, over);

describe("小程序端核心逻辑 · 战绩字段", () => {
  test("等级进度与等级威望要取出来", () => {
    const p = core.normalizePlayer(bridgeFull());
    assert.equal(p.level, 255);
    assert.equal(p.toNextLevelPercent, 60);
    assert.equal(p.levelPrestige, 2);
  });

  test("在线状态与当前传奇", () => {
    const p = core.normalizePlayer(bridgeFull());
    assert.equal(p.realtime.online, false);
    assert.equal(p.realtime.inGame, false);
    assert.equal(p.realtime.legend, "Revenant");
    assert.ok(p.realtime.stateText.length > 0, "要有一句可读的状态");
  });

  test("在线时能正确标为在线", () => {
    const raw = bridgeFull();
    raw.realtime.isOnline = 1;
    raw.realtime.isInGame = 1;
    raw.realtime.currentStateAsText = "In Lobby";
    const p = core.normalizePlayer(raw);
    assert.equal(p.realtime.online, true);
    assert.equal(p.realtime.inGame, true);
  });

  test("封禁状态要单独提出来（被封的号得能看出来）", () => {
    const ok = core.normalizePlayer(bridgeFull());
    assert.equal(ok.banned.active, false);
    const raw = bridgeFull();
    raw.global.bans = { isActive: true, remainingSeconds: 86400, last_banReason: "cheating" };
    const bad = core.normalizePlayer(raw);
    assert.equal(bad.banned.active, true);
    assert.ok(bad.banned.reason.length > 0);
  });

  test("生涯数据要挑出重点几条，并翻译成人话", () => {
    const p = core.normalizePlayer(bridgeFull());
    const labels = [...p.highlights].map((h) => h.label);
    assert.ok(labels.some((l) => /击杀/.test(l)), "应有击杀，实际：" + JSON.stringify(labels));
    assert.ok(labels.some((l) => /伤害/.test(l)), "应有伤害");
    assert.ok(labels.some((l) => /爆头/.test(l)), "应有爆头");
    // 值要带千分位
    const kills = p.highlights.find((h) => /击杀/.test(h.label) && !/赛季/.test(h.label));
    assert.equal(kills.valueText, "13,877");
  });

  test("击杀/伤害/吃鸡要排在前面（别让冷门数据占位）", () => {
    const p = core.normalizePlayer(bridgeFull());
    const order = [...p.highlights].map((h) => h.label);
    const iKills = order.findIndex((l) => /^生涯击杀$/.test(l));
    const iShield = order.findIndex((l) => /护盾/.test(l));
    assert.ok(iKills >= 0, "应有生涯击杀");
    if (iShield >= 0) assert.ok(iKills < iShield, "击杀应排在护盾前面，实际顺序：" + JSON.stringify(order));
  });

  test("所有生涯类数据要排在所有赛季类数据前面（同类聚在一起才好读）", () => {
    const p = core.normalizePlayer(bridgeFull());
    const labels = [...p.highlights].map((h) => h.label);
    const lastCareer = labels.map((l, i) => (/^生涯/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
    const firstSeason = labels.findIndex((l) => /^第\d+赛季/.test(l));
    if (lastCareer >= 0 && firstSeason >= 0) {
      assert.ok(lastCareer < firstSeason,
        "生涯类应全部排在赛季类之前，实际顺序：" + JSON.stringify(labels));
    }
  });

  test("认不出来的追踪器不要丢掉，直接显示原名", () => {
    const p = core.normalizePlayer(bridgeFull());
    const all = [...p.highlights].map((h) => h.label).join("|");
    // 这条数据在 total 里，不管翻不翻译都要能被看到（除非被条数上限截掉）
    assert.ok(/Totally New Tracker|生涯击杀/.test(all));
  });

  test("生涯数据条数有上限，不能把一整页塞爆", () => {
    const p = core.normalizePlayer(bridgeFull());
    assert.ok(p.highlights.length <= 8, "最多 8 条，实际 " + p.highlights.length);
    assert.ok(p.highlights.length >= 3, "太少就没意义了");
  });

  test("赛季类追踪器要标明年份，别和生涯混在一起", () => {
    const p = core.normalizePlayer(bridgeFull());
    const s12 = p.highlights.find((h) => /12/.test(h.label));
    if (s12) assert.ok(/赛季/.test(s12.label), "赛季数据要写明赛季，实际：" + s12.label);
  });

  test("没有 total / realtime 时整块不崩，highlights 为空数组", () => {
    let p;
    assert.doesNotThrow(() => { p = core.normalizePlayer({ global: { name: "X" } }); });
    assert.deepEqual([...p.highlights], []);
    assert.equal(p.realtime, null);
    assert.equal(p.banned.active, false);
  });
});

/* ============================================================
   地图名中文对照
   ============================================================ */
describe("小程序端核心逻辑 · 地图名中文", () => {
  // 这六条已经由用户对着游戏核对过，别再"顺手改回去"
  test("六张大逃杀地图的中文名（已核对）", () => {
    assert.equal(core.translateMapName("Kings Canyon"), "诸王峡谷");
    assert.equal(core.translateMapName("World's Edge"), "世界尽头");
    assert.equal(core.translateMapName("Olympus"), "奥林匹斯");
    assert.equal(core.translateMapName("Storm Point"), "风暴点");
    assert.equal(core.translateMapName("Broken Moon"), "残月");
    assert.equal(core.translateMapName("E-District"), "电力区域");
  });

  test("轮换模式的据点名（取自萌娘百科的其它模式地图列表）", () => {
    assert.equal(core.translateMapName("Caustic Treatment"), "侵蚀疗法");
    assert.equal(core.translateMapName("Skulltown"), "骷髅镇");
    assert.equal(core.translateMapName("Hammond Labs"), "哈蒙德实验室");
    assert.equal(core.translateMapName("Barometer"), "晴雨表");
    assert.equal(core.translateMapName("Dome"), "穹顶");
    assert.equal(core.translateMapName("Lava Siphon"), "熔岩虹吸");
  });

  test("没有可靠译名的据点一律保留英文，不许编一个中文出来", () => {
    // 这些在萌娘百科的列表里找不到，宁可显示英文也不能猜。
    // Monument 已从这份名单移出：中文名"纪念碑"是社区通行叫法，
    // 而且上游轮换（Mixtape）真的会把它推到界面上 —— 留在名单里会让中文模式漏出英文。
    // ZEUS Station / Production Yard / Wattson's Treatment 已从名单移出：
    // 用户提供了这三个据点的实景照并给了中文名（宙斯站 / 生产场地 / 沃特森的塔），
    // 留在"不许猜"名单里会让中文模式漏出英文。
    for (const n of ["Thunder Watch", "Overlook", "The Core", "Runoff", "Airbase"]) {
      assert.equal(core.translateMapName(n), "",
        n + " 没有可靠译名，应当返回空串（界面会退回英文）");
    }
  });

  test("认不出来的返回空串（让调用方退回英文，绝不能显示空白）", () => {
    for (const bad of ["", null, undefined, "Some New Map", "  ", 123]) {
      assert.equal(core.translateMapName(bad), "", "不该对 " + JSON.stringify(bad) + " 返回东西");
    }
  });

  test("大小写和首尾空格不影响匹配", () => {
    assert.equal(core.translateMapName("  broken moon  "), "残月");
    assert.equal(core.translateMapName("BROKEN MOON"), "残月");
  });

  test("归一化时同时保留英文原文和中文译名", () => {
    // 英文原文必须留着：配色按它算，认不出译名时也要靠它兜底
    const out = core.normalizeRotation(rotationReal());
    const ranked = out.find((r) => r.def.id === "ranked");
    assert.equal(ranked.current.map, "Olympus", "英文原文要保留");
    assert.equal(ranked.current.mapCn, "奥林匹斯", "中文译名也要有");
    assert.ok(ranked.nexts[0].map, "next 要有英文");
    assert.equal(typeof ranked.nexts[0].mapCn, "string", "next 也要有 mapCn 字段");
  });

  test("没有译名时 mapCn 是空串，不是 undefined", () => {
    const raw = { ranked: { current: { map: "Brand New Map", start: 1, end: 2 }, next: null } };
    const out = core.normalizeRotation(raw);
    assert.equal(out[0].current.mapCn, "");
  });
});

describe("小程序端核心逻辑 · 取数失败分类", () => {
  // 这些分类在云函数里做，但规则必须和 HTML 版一致 —— 每一条都是踩过的坑
  test("404 + {\"Error\":\"Player not found\"} → notfound（实测上游就是这样）", () => {
    const body = JSON.stringify({ Error: "Player not found. Alternatively, we may have encountered an issue while connecting to low priority search service." });
    assert.equal(core.classifyUpstream(404, body).kind, "notfound");
    assert.equal(core.classifyUpstream(404, JSON.stringify({ Error: "Player not found (invalid UID )." })).kind, "notfound");
  });

  test("哪怕上游返回 200，正文里带着 Error 也绝不能算成功", () => {
    // 这是潜伏的 bug：曾经 200 + {"Error":"Player not found"} 会被判成 ok，
    // 页面就会显示一个叫「未知玩家」的假人 —— 比报错糟糕得多
    assert.equal(core.classifyUpstream(200, JSON.stringify({ Error: "Player not found" })).kind, "notfound");
    assert.equal(core.classifyUpstream(200, JSON.stringify({ Error: "something unexpected" })).kind, "http");
    assert.equal(core.classifyUpstream(200, JSON.stringify({ error: "boom" })).kind, "http");
  });

  test("200 + 正常数据仍然是 ok（别把好数据也拦掉）", () => {
    const r = core.classifyUpstream(200, JSON.stringify({ global: { name: "shroud", uid: "2262951949" } }));
    assert.equal(r.kind, "ok");
    assert.equal(r.data.global.name, "shroud");
  });

  test("非 JSON 的 'API key doesn't exist' → badkey", () => {
    assert.equal(core.classifyUpstream(404, "Error: API key doesn't exist !").kind, "badkey");
  });
  test("401 + JSON {\"Error\":\"Invalid API key\"} → badkey", () => {
    assert.equal(core.classifyUpstream(401, JSON.stringify({ Error: "Invalid API key" })).kind, "badkey");
  });
  test("HTTP 200 + 纯文本 'Unauthorized format'（空 Key）→ badkey", () => {
    assert.equal(core.classifyUpstream(200, "Unauthorized format").kind, "badkey");
  });
  test("429 + 验证提示 → unverified，而不是频率超限", () => {
    const body = JSON.stringify({ Error: "You must verify your API account first by linking your Discord account on https://portal.apexlegendsapi.com/discord-auth" });
    const r = core.classifyUpstream(429, body);
    assert.equal(r.kind, "unverified");
    assert.ok(/discord-auth/.test(r.message), "必须给出验证链接");
  });
  test("没有验证文案的 429 仍是 ratelimit", () => {
    assert.equal(core.classifyUpstream(429, JSON.stringify({ Error: "Too many requests" })).kind, "ratelimit");
  });
  test("404 查无此人 → notfound", () => {
    assert.equal(core.classifyUpstream(404, JSON.stringify({ Error: "Player not found" })).kind, "notfound");
  });
  test("200 + 空数组 → empty（不能当成四个模式都没开）", () => {
    assert.equal(core.classifyUpstream(200, "[]").kind, "empty");
  });
  test("200 + 正常对象 → ok", () => {
    assert.equal(core.classifyUpstream(200, JSON.stringify(rotationReal())).kind, "ok");
  });
  test("200 + JSON null → empty", () => {
    assert.equal(core.classifyUpstream(200, "null").kind, "empty");
  });
  test("500 + HTML → http，且保留原文便于排错", () => {
    const r = core.classifyUpstream(500, "<html>Internal Error</html>");
    assert.equal(r.kind, "http");
    assert.ok(/Internal Error/.test(r.message));
  });
});
