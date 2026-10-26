// Evo 战绩（2026-10-27 起）：云函数 evo_mp 的统计（cloudfunctions/evo_mp/stats.js）
// 和小程序里拼中英文的 evo/utils/view.js。两边都是纯函数，直接测。
//
// 统计的算法和 Evo 电脑窗口一样（Evo 仓库 code/panel_app.py），两边显示的数字必须对得上 ——
// 最容易错的是四舍五入：Python 是"按真实值、正好一半取偶数"，JS 的 Math.round 不是。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MP = path.join(ROOT, "miniprogram");
const require = createRequire(import.meta.url);

const S = require(path.join(ROOT, "cloudfunctions", "evo_mp", "stats.js"));
const view = require(path.join(MP, "evo", "utils", "view.js"));
const i18n = require(path.join(MP, "utils", "i18n.js"));
const codex = require(path.join(MP, "utils", "codex_data.js"));

const ZH = i18n.T("zh");
const EN = i18n.T("en");
const CJK = /[一-鿿　-〿＀-￯]/;

const match = (over = {}) => Object.assign({
  _id: "dev:1", match_id: 1, ended_at: "2026-10-26 21:03:15", player_key: "a", mode: "ranked", map: "残月", legend: "恶灵",
  placement: 5, kills: 2, assists: 1, knockdowns: 3, damage: 800, rp_delta: 30, rp_source: "经验值页",
  rank_tier: "钻石", rank_division: "II", rank_progress: 40, rank_score: 11040, needs_review: false,
}, over);

describe("evo · 统计（云函数 stats.js）", () => {
  test("四舍五入和 Python 一样：正好一半取偶数，按真实值算", () => {
    assert.equal(S.pyRound(12.5), 12);
    assert.equal(S.pyRound(13.5), 14);
    assert.equal(S.pyRound(8.35, 1), 8.3);   // 8.35 在计算机里是 8.3499…
    assert.equal(S.pyRound(8.25, 1), 8.2);   // 8.25 是精确值，取偶数
    assert.equal(S.pyRound(-2.5), -2);
    assert.equal(S.pyRound(1234.4), 1234);
  });

  test("场均：读不出来的局不算进去（不当作 0），计分次数的击杀不算场均击杀", () => {
    const n = S.groupNumbers([
      match({ placement: 1, kills: 4, damage: 1000 }),
      match({ placement: null, kills: null, damage: null }),
      match({ placement: 9, kills: 9, kills_counted: true, damage: 500 }),
    ]);
    assert.equal(n.games, 3);
    assert.equal(n.avg_place, 5);
    assert.equal(n.avg_kills, 4);
    assert.equal(n.avg_damage, 750);
    assert.equal(n.win_rate, 50);
    assert.equal(n.top5, 50);
  });

  test("一局都没有名次时，比率是 null（界面显示—），不是 0%", () => {
    const n = S.groupNumbers([match({ placement: null })]);
    assert.equal(n.win_rate, null);
    assert.equal(n.top5, null);
    assert.equal(n.avg_place, null);
  });

  test("RP 合计：没有 RP 的局跳过；一局都没有时是 null", () => {
    assert.equal(S.rpSum([match({ rp_delta: 30 }), match({ rp_delta: -12 }), match({ rp_delta: null })]), 18);
    assert.equal(S.rpSum([match({ rp_delta: null })]), null);
  });

  test("段位：大厅读数更新时以大厅为准；段位名换成代号", () => {
    const rows = [match()];
    const lobby = [{ read_at: "2026-10-26 21:10:00", rank_tier: "大师", rank_division: null, rank_progress: 120, score: 15120 }];
    assert.deepEqual(S.rankCard(rows, lobby),
      { tier: "master", division: null, progress: 120, when: "2026-10-26 21:10:00", from_lobby: true });
    const older = [{ read_at: "2026-10-26 20:00:00", rank_tier: "白金", rank_division: "I", rank_progress: 0, score: 9000 }];
    assert.equal(S.rankCard(rows, older).tier, "diamond");
    assert.equal(S.rankCard(rows, older).division, "II");
    assert.equal(S.rankCard([], []), null);
    assert.equal(S.rankCard([match({ rank_tier: "没见过的段位" })], []), null, "认不出的段位不显示，不猜");
  });

  test("RP 走势：少于 2 局不画；分界线名字换成代号；大厅分数更新时接在最后", () => {
    assert.equal(S.rpChart([match()], [], []), null);
    const rows = [match({ rank_score: 10900 }), match({ rank_score: 11040, ended_at: "2026-10-26 22:00:00" })];
    const bounds = [[10000, "钻石 IV"], [11000, "钻石 III"], [12000, "钻石 II"]];
    const c = S.rpChart(rows, [{ read_at: "2026-10-26 23:00:00", score: 11100 }], bounds);
    assert.equal(c.count, 2);
    assert.equal(c.points.length, 3, "大厅读数接在最后");
    assert.ok(c.lines.some((l) => l.tier === "diamond" && l.division === "III"));
    assert.ok(c.points.every((p) => p >= 0 && p <= 1));
  });

  test("传奇表现：最多 3 个，其余合成「其他」（name 为 null）", () => {
    const rows = ["恶灵", "恶灵", "恶灵", "命脉", "命脉", "幻象", "侵蚀"].map((legend) => match({ legend }));
    const bars = S.legendBars(rows);
    assert.equal(bars.length, 4);
    assert.deepEqual(bars.map((b) => b.name), ["恶灵", "命脉", "幻象", null]);
    assert.equal(bars[3].other, true);
    assert.equal(bars[0].segments.reduce((a, s) => a + s.width, 0), 100);
    assert.equal(S.legendBars([match({ legend: null })]), null);
  });

  test("账号：只有 1 个时不分；2 个以上默认最近玩过的；all = 全部", () => {
    const acc = S.mergeAccounts([{ accounts: [{ name: "A", keys: ["a"] }, { name: "B", keys: ["b"] }], bounds: [[0, "菜鸟 IV"]] }]);
    assert.equal(acc.accounts.length, 2);
    assert.deepEqual(acc.bounds, [[0, "菜鸟 IV"]]);
    const rows = [match({ player_key: "a", ended_at: "2026-10-01 10:00:00" }), match({ player_key: "b", ended_at: "2026-10-02 10:00:00" })];
    assert.equal(S.accountView(acc.accounts, rows, null).current, "1");
    assert.equal(S.accountView(acc.accounts, rows, "0").current, "0");
    assert.equal(S.accountView(acc.accounts, rows, "all").filter, null);
    assert.deepEqual(S.accountView(acc.accounts.slice(0, 1), rows, null).accounts, []);
  });

  test("两台电脑上用过同一个名字的账号合成一个", () => {
    const acc = S.mergeAccounts([
      { accounts: [{ name: "A", keys: ["a", "a2"] }] },
      { accounts: [{ name: "A 新名字", keys: ["a2", "a3"] }] },
    ]);
    assert.equal(acc.accounts.length, 1);
    assert.equal(acc.accounts[0].keys.size, 3);
  });

  test("「今天」从早上 5 点算起，按电脑的时区", () => {
    const at = (iso) => S.localNow(480, Date.parse(iso));
    assert.equal(S.dayStartText(at("2026-10-26T12:00:00Z")), "2026-10-26 05:00:00");   // 北京 20:00
    assert.equal(S.dayStartText(at("2026-10-26T19:00:00Z")), "2026-10-26 05:00:00");   // 北京 03:00 → 还算前一天
    assert.equal(at("2026-10-26T19:00:00Z").date, "2026-10-27");
  });

  test("单局详情：RP 来源换成代号；不是待确认的局不带原因", () => {
    const d = S.detailData(match({ review_note: "x" }));
    assert.equal(d.rp_source, "xp");
    assert.equal(d.review_note, null);
    assert.equal(d.rank_tier, "diamond");
    assert.equal(S.detailData(match({ rp_delta: null })).rp_source, null, "没有 RP 就没有来源");
  });
});

describe("evo · 界面字段（evo/utils/view.js）", () => {
  test("填空、单复数、正负号（真正的减号）、读不出来是—", () => {
    assert.equal(view.fill("有 {n} 局", { n: 3 }), "有 3 局");
    assert.equal(view.count(EN.evoReviewN, 1), "1 match needs review");
    assert.equal(view.count(EN.evoReviewN, 3), "3 matches need review");
    assert.equal(view.count(ZH.evoReviewN, 1), "有 1 局识别结果不确定");
    assert.equal(view.signed(1234), "+1,234");
    assert.equal(view.signed(-5), "−5");
    assert.equal(view.signed(null), "—");
  });

  test("每个 Evo 认得的传奇都对得上图鉴（头像、英文名从图鉴取）", () => {
    const ids = new Set(codex.heroes.map((h) => h.id));
    const missing = Object.entries(view.LEGEND_IDS).filter(([, id]) => !ids.has(id));
    assert.deepEqual(missing, [], "图鉴里没有这些 id");
    for (const hero of codex.heroes) {
      assert.ok(existsSync(path.join(MP, hero.icon)), "头像文件不存在：" + hero.icon);
    }
  });

  test("传奇名：中文用游戏里的叫法，英文用图鉴；图鉴里没有的保留原文、没有头像", () => {
    assert.deepEqual(view.legend("恶灵", ZH), { name: "恶灵", icon: "/assets/heroes/wraith.png" });
    assert.equal(view.legend("兰伯特", ZH).name, "兰伯特", "游戏里叫兰伯特（图鉴写的是兰帕特）");
    assert.equal(view.legend("兰伯特", EN).name, "Rampart");
    assert.deepEqual(view.legend("新传奇", EN), { name: "新传奇", icon: "" });
  });

  test("地图名：英文模式反查 MAP_CN；残月改名前的「破碎月亮」也认得", () => {
    assert.equal(view.mapName("残月", EN), "Broken Moon");
    assert.equal(view.mapName("破碎月亮", EN), "Broken Moon");
    assert.equal(view.mapName("世界尽头", EN), "World's Edge");
    assert.equal(view.mapName("残月", ZH), "残月");
    assert.equal(view.mapName("没见过", EN), "没见过", "查不到保留原文，不编");
  });

  test("段位名两种语言", () => {
    assert.equal(view.tierName("diamond", "II", ZH), "钻石 II");
    assert.equal(view.tierName("predator", null, EN), "Apex Predator");
    assert.equal(view.tierName("nope", null, EN), "");
  });

  test("时间：今天 / 昨天 / 更早的写日期", () => {
    const ctx = { T: ZH, today: "2026-10-26", yesterday: "2026-10-25" };
    assert.equal(view.timeText("2026-10-26 21:03:15", ctx), "今天 21:03");
    assert.equal(view.timeText("2026-10-25 08:00:00", ctx), "昨天 08:00");
    assert.equal(view.timeText("2026-10-01 08:00:00", ctx), "10-01 08:00");
    assert.equal(view.timeText("2026-10-26 21:03:15", Object.assign({}, ctx, { T: EN })), "Today 21:03");
  });

  const overviewData = (over = {}) => Object.assign({
    bound: true, accounts: [], account: null, range: "30", today: "2026-10-26", yesterday: "2026-10-25", total: 1,
    rank: { tier: "diamond", division: "II", progress: 40, when: "2026-10-26 21:03:15", from_lobby: false },
    chart: null, range_rp: 30, today_rp: -5, today_games: 1,
    stats: { games: 1, avg_place: 5, avg_kills: 2, avg_damage: 800, top5: 100, win_rate: 0 },
    recent: [S.rowData(match())], legends: S.legendBars([match()]), review_count: 0,
  }, over);

  test("我的战绩：没绑定 / 绑定了没对局 / 有数据", () => {
    assert.equal(view.overview(overviewData({ bound: false }), ZH, 160).state, "unbound");
    assert.equal(view.overview(overviewData({ total: 0 }), ZH, 160).state, "empty");
    const v = view.overview(overviewData(), ZH, 160);
    assert.equal(v.state, "ready");
    assert.equal(v.rank.name, "钻石 II");
    assert.equal(v.rank.hasEmblem, true);
    assert.equal(v.rangeRp, "+30");
    assert.equal(v.todayRp, "−5");
    assert.equal(v.todayRpCls, "bad");
    assert.equal(v.recent[0].title, "恶灵 · 残月");
    assert.equal(v.recent[0].place, "#5");
    assert.equal(v.stats.find((s) => s.key === "place").value, "5.0");
  });

  test("全部账号时不显示段位和走势（段位按账号分开）", () => {
    const v = view.overview(overviewData({ accounts: [{ key: "0", name: "A" }, { key: "1", name: "B" }], account: "all" }), ZH, 160);
    assert.equal(v.all, true);
    assert.equal(v.rank, null);
    assert.equal(v.picker.index, 2);
    assert.equal(v.picker.names[2], "全部账号");
  });

  test("每个有徽章的段位，徽章图片都在分包里", () => {
    for (const tier of ["bronze", "silver", "gold", "platinum", "diamond", "master", "predator"]) {
      const v = view.overview(overviewData({ rank: { tier, division: "I", progress: 1, when: null, from_lobby: false } }), ZH, 160);
      assert.ok(existsSync(path.join(MP, v.rank.emblem)), "缺徽章：" + v.rank.emblem);
    }
    const rookie = view.overview(overviewData({ rank: { tier: "rookie", division: "IV", progress: 1, when: null, from_lobby: false } }), ZH, 160);
    assert.equal(rookie.rank.hasEmblem, false, "菜鸟没有徽章图，用字母方块");
    assert.equal(rookie.rank.letter, "R4");
  });

  test("英文模式：拼出来的显示文字里没有中文（认得的传奇、地图、段位）", () => {
    const v = view.overview(overviewData({ review_count: 2,
      chart: { points: [0.2, 0.5], lines: [{ y: 0.3, tier: "diamond", division: "III" }], count: 2 } }), EN, 160);
    const texts = [];
    (function walk(o) {
      if (typeof o === "string") texts.push(o);
      else if (o && typeof o === "object") Object.keys(o).forEach((k) => { if (!["icon", "emblem", "key", "id"].includes(k)) walk(o[k]); });
    })(v);
    const bad = texts.filter((s) => CJK.test(s));
    assert.deepEqual(bad, [], "英文模式混了中文：" + bad.join(" | "));
  });

  test("单局详情：待确认的原因是中文，英文模式下不显示；RP 来源跟着语言", () => {
    const d = { today: "2026-10-26", yesterday: "2026-10-25",
      match: S.detailData(match({ needs_review: true, review_note: "名次两处对不上", no_summary: true,
        mates: [{ name: "x", legend: "命脉", kills: 1 }] })) };
    const zh = view.detail(d, ZH);
    assert.equal(zh.reviewNote, "名次两处对不上");
    assert.equal(zh.rpFrom, "来自经验值页");
    assert.equal(zh.noSummary, true);
    assert.equal(zh.mates[0].legend, "命脉");
    const en = view.detail(d, EN);
    assert.equal(en.reviewNote, "");
    assert.equal(en.rpFrom, "from XP screen");
    assert.equal(en.mates[0].legend, "Lifeline");
    assert.ok(en.facts.some((f) => f.key === "rank" && f.value === "Diamond II 40"));
  });

  test("错误代号 → 两种语言的一句话；认不出的代号给通用的话", () => {
    assert.equal(view.errText("expired", ZH), ZH.evoErrExpired);
    assert.equal(view.errText("network", EN), EN.evoErrNetwork);
    assert.equal(view.errText("whatever", EN), EN.evoErrServer);
  });

  test("绑定码：小程序码的 scene、Evo 二维码的网址、裸码都认得", () => {
    assert.equal(view.bindCodeFrom("evo/bind/bind?scene=ABCDEFGH23"), "ABCDEFGH23");
    assert.equal(view.bindCodeFrom("https%3A%2F%2Fevotracker.cn%2Fbind%3Fc%3Dabcdefgh23"), "ABCDEFGH23");
    assert.equal(view.bindCodeFrom("ABCDEFGH23"), "ABCDEFGH23");
    assert.equal(view.bindCodeFrom("随便什么"), "");
    assert.equal(view.bindCodeFrom("%E0%A4%A"), "", "坏的转义不抛错");
  });

  test("我的：电脑编号、同步时间、改过名的账号", () => {
    const v = view.devicesView({ devices: [{ id: "u1", bound_at: "2026-10-26 20:00", last_upload_at: null, app_version: "0.4.1", matches: 12 }],
      accounts: [{ name: "A", names: 2 }, { name: "B", names: 1 }] }, ZH);
    assert.equal(v.devices[0].name, "电脑 1");
    assert.equal(v.devices[0].sync, "还没有同步过");
    assert.equal(v.devices[0].count, "云端 12 局 · Evo 0.4.1");
    assert.equal(v.accounts[0].names, "用过 2 个名字");
    assert.equal(v.accounts[1].names, "");
  });
});
