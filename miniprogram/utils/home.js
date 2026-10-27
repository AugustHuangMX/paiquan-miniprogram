/**
 * 首页（2026-10-27 起第 1 个 tab）：地图轮换数据 → 「现在玩什么」那一块的界面字段，外加问候语、赛事卡。
 *
 * 纯函数，tests/home.test.mjs 直接测；页面只管"取数 + setData"（同 AI-CONTEXT §3 的分层约定）。
 * 数据和「全部地图」（pages/maps）是同一份（云端 rotation → viewmodel.buildModes），只是排法不同：
 * 置顶的模式（默认排位）做成深色大卡，其余的并排成小卡。显示哪些模式、置顶哪个，都跟「全部地图」⚙ 里的设置走。
 */
var core = require("./core.js");
var i18n = require("./i18n.js");

/** "{t}后" + { t: "9 分" } → "9 分后" */
function fill(tpl, vars) {
  return String(tpl == null ? "" : tpl).replace(/\{(\w+)\}/g, function (all, k) {
    return vars[k] == null ? "" : String(vars[k]);
  });
}

/** 问候语按手机上的时间：5–11 点早上好，11–13 点中午好，13–18 点下午好，其余晚上好 */
function greeting(hour, lang) {
  var T = i18n.T(lang);
  if (hour >= 5 && hour < 11) return T.homeMorning;
  if (hour >= 11 && hour < 13) return T.homeNoon;
  if (hour >= 13 && hour < 18) return T.homeAfternoon;
  return T.homeEvening;
}

/** 还剩多少秒 → "9 分" / "1 小时 5 分"。不足 1 分钟也说 1 分（倒计时还在走，不能说 0 分） */
function remainText(sec, lang) {
  var T = i18n.T(lang);
  var min = Math.max(1, Math.ceil(sec / 60));
  if (min < 60) return fill(T.homeMin, { n: min });
  return fill(T.homeHourMin, { h: Math.floor(min / 60), m: min % 60 });
}

/**
 * 从 buildModes 的结果里挑大卡和小卡。
 * 只看 shown 里的模式（「全部地图」⚙ 里勾选显示的）；大卡 = 置顶的那个（匹配或排位），
 * 它没勾选或没开就取第一个开着的模式；其余按原顺序（匹配 → 排位 → 外卡 → 轮换）做小卡。
 */
function pickModes(modes, shown, pin) {
  var list = (modes || []).filter(function (m) { return m && shown.indexOf(m.id) >= 0; });
  var hero = null;
  list.forEach(function (m) { if (!hero && m.id === pin && m.active) hero = m; });
  list.forEach(function (m) { if (!hero && m.active) hero = m; });
  if (!hero) hero = list[0] || null;
  return { hero: hero, smalls: list.filter(function (m) { return m !== hero; }) };
}

var SHORT_LABEL = { ranked: "homeModeRanked", pubs: "homeModePubs", wildcard: "homeModeWildcard", mixtape: "homeModeMixtape" };

/** 首页卡片上的模式名用短的（排位赛 / 匹配 / 外卡 / 轮换）；认不出的模式用 viewmodel 给的名字 */
function shortLabel(m, lang) {
  return SHORT_LABEL[m.id] ? i18n.t(lang, SHORT_LABEL[m.id]) : m.label;
}

/** 大卡：「本场 13:30 – 18:00 · 接着 残月」 */
function heroCard(m, lang) {
  var T = i18n.T(lang);
  var parts = [];
  if (m.active) {
    parts.push(T.thisRound + " " + m.span);
    if (m.nexts && m.nexts[0]) parts.push(fill(T.homeThen, { map: m.nexts[0].map }));
  }
  return {
    id: m.id,
    label: shortLabel(m, lang),
    active: m.active,
    map: m.map || "",
    tint: m.tint,
    sub: parts.join(" · "),
    startSec: m.startSec,
    endSec: m.endSec,
    nextMap: m.nexts && m.nexts[0] ? m.nexts[0].map : "",
    cd: "--:--",
    pct: 0,
    urgent: false,
    soon: ""
  };
}

/** 小卡：标题是模式名，轮换再带上这一轮的玩法（「轮换 · 子弹时间」），没有地图照片，玩法必须写出来 */
function smallCard(m, lang) {
  var card = heroCard(m, lang);
  card.title = m.eventText ? card.label + " · " + m.eventText : card.label;
  return card;
}

/**
 * 每秒重算的字段：倒计时、进度、小卡上的「9 分后 → 残月」。
 * overdue = 已经过了轮换时间 8 秒还没换（该重新取数了）。没开的模式回 null。
 */
function tickFields(card, nowMs, lang) {
  if (!card || !card.active || !card.endSec) return null;
  var T = i18n.T(lang);
  var remain = card.endSec - nowMs / 1000;
  var total = card.endSec - card.startSec;
  var left = remain > 0 ? fill(T.homeIn, { t: remainText(remain, lang) }) : T.rotatingNow;
  return {
    cd: remain > 0 ? core.fmtDur(remain) : T.rotatingNow,
    urgent: remain > 0 && remain < 5 * 60,
    pct: total > 0 ? Number(Math.min(100, Math.max(0, (nowMs / 1000 - card.startSec) / total * 100)).toFixed(1)) : 0,
    soon: card.nextMap ? left + " → " + card.nextMap : left,
    overdue: remain < -8
  };
}

/** 赛事卡：下一场比赛（比赛页同一份离线赛程，utils/nextmatch.js 的 build 结果）。没有赛程时回 null */
function esportsCard(nm, lang) {
  if (!nm) return null;
  var T = i18n.T(lang);
  return {
    name: nm.eventLabel || nm.nextMatchText,
    sub: nm.hasNext ? fill(T.homeNextMatch, { t: nm.nextTimeText }) : (nm.hasStatus ? nm.statusText : "")
  };
}

module.exports = {
  greeting: greeting,
  remainText: remainText,
  pickModes: pickModes,
  heroCard: heroCard,
  smallCard: smallCard,
  tickFields: tickFields,
  esportsCard: esportsCard
};
