/**
 * 英雄选取率（分段位）—— 从上游**网站**抓 HTML 解析。
 *
 * 为什么走网页而不是 API：ALS 的 API 里没有这个数据（试过 11 个候选端点，全 404），
 * 只有网站上有。好在他们 robots.txt 是 `Allow: /`，明确允许抓取。
 *
 * **风险与防守**：网页结构一变解析就坏 —— 所以解析失败时**整块不显示**，
 * 绝不退化成 0 或空列表（那会被读成"这个英雄没人玩"，属于假数据）。
 */

var fetcher = require("./fetcher");

var BASE = "https://apexlegendsstatus.com";
var TIMEOUT = 8000;
var CACHE_TTL = 60 * 60 * 1000;   // 1 小时。上游数据按天变，抓太勤没意义还给人添负担

// 要的四个段位（上游每个段位一个页面）
var TIERS = [
  { key: "all", label: "全段位", path: "/game-stats/legends-pick-rates" },
  { key: "platinum", label: "白金", path: "/game-stats/legends-pick-rates/Platinum" },
  { key: "diamond", label: "钻石", path: "/game-stats/legends-pick-rates/Diamond" },
  { key: "master", label: "大师+猎杀", path: "/game-stats/legends-pick-rates/Masterpred" },
];

var cache = { at: 0, data: null };

/**
 * 英雄英文名 → 中文名。
 *
 * 译名口径：**用国内玩家实际在用的叫法**，而不是 EA 营销页那套。
 * 两套确实不一样，实测对照（EA 官方简体页 vs 国内社区/百度百科）：
 *   Octane   官方「辛烷」    / 社区「动力小子」
 *   Crypto   官方「暗码士」  / 社区「密客」
 *   Caustic  官方「腐蚀」    / 社区「侵蚀」
 *   Wattson  官方「华森」    / 社区「沃特森」
 *   Rampart  官方「蕾帕特」  / 社区「兰伯特」
 *   Vantage  官方「万塔捷」  / 社区「万蒂奇」
 * 玩家搜的是社区那套，所以这里用社区名。
 *
 * 两个新英雄查不到社区名，用官方名：
 *   Sparrow → 琉雀（EA 官方帮助页《琉雀指南》）
 *   Axle    → 艾克赛尔（S29 新英雄，百度百科词条）
 * 注：网上流传的「轴锋」「雀影」是博主/台媒自译，**不是官方名**，所以没采用。
 *
 * 表放在云端有个好处：**改译名只要部署云函数，不用重新提审小程序**（和地图译名一个道理）。
 * 表里没有的英雄会**原样显示英文名**（绝不显示空白）—— 上游出新英雄时能立刻看出来。
 */
var LEGEND_CN = {
  "Pathfinder": "探路者",
  "Wraith": "恶灵",
  "Octane": "动力小子",
  "Bangalore": "班加罗尔",
  "Lifeline": "命脉",
  "Gibraltar": "直布罗陀",
  "Bloodhound": "寻血猎犬",
  "Caustic": "侵蚀",
  "Mirage": "幻象",
  "Wattson": "沃特森",
  "Crypto": "密客",
  "Revenant": "亡灵",
  "Loba": "罗芭",
  "Rampart": "兰伯特",
  "Horizon": "地平线",
  "Fuse": "暴雷",
  "Valkyrie": "瓦尔基里",
  "Seer": "希尔",
  "Ash": "艾许",
  "Mad Maggie": "疯玛吉",
  "Newcastle": "纽卡斯尔",
  "Vantage": "万蒂奇",
  "Catalyst": "卡特莉丝",
  "Ballistic": "弹道",
  "Conduit": "导线管",
  "Alter": "变幻",
  "Sparrow": "琉雀",
  "Axle": "艾克赛尔",
};

var LEGEND_CN_LOWER = {};
Object.keys(LEGEND_CN).forEach(function (k) { LEGEND_CN_LOWER[k.toLowerCase()] = LEGEND_CN[k]; });

/** @returns {string} 中文名；查不到返回空串（调用方退回英文原文） */
function translateLegend(name) {
  if (name == null) return "";
  var key = String(name).trim().toLowerCase();
  if (!key) return "";
  return LEGEND_CN_LOWER[key] || "";
}

/**
 * 解析页面里的英雄块。每个英雄是一段 `<div class="legends-banner__item" ...>`：
 *
 *   alt="Pathfinder"                               ← 名字
 *   <span style="font-size: 36px;">12.1%</span>    ← 选取率
 *   <span ...>▲</span>5.97%                        ← 涨跌（▲ 涨 / ▼ 落）
 *   Avg level <span ...>615</span>                 ← 平均等级（只有分段页有）
 *
 * 名字或选取率解析不出来的块**直接跳过** —— 宁可少几条，也不要错的。
 */
function parseLegends(html) {
  var out = [];
  var blocks = String(html == null ? "" : html).split('class="legends-banner__item"');
  blocks.shift();   // 第一段是列表之前的内容

  blocks.forEach(function (b) {
    var name = b.match(/alt="([^"]+)"/);
    var rate = b.match(/font-size:\s*36px;"\s*>([\d.]+)%/);
    if (!name || !rate) return;

    var trend = b.match(/([▲▼])\s*<\/span>\s*([\d.]+)%/);
    var level = b.match(/level\s*<span[^>]*>\s*([\d,]+)/i);
    var en = name[1];

    out.push({
      // name 是给界面用的中文名；表里没有的英雄原样退回英文，绝不显示空白
      name: translateLegend(en) || en,
      nameEn: en,
      pickRate: parseFloat(rate[1]),
      up: trend ? trend[1] === "▲" : null,
      change: trend ? parseFloat(trend[2]) : null,
      avgLevel: level ? parseInt(level[1].replace(/,/g, ""), 10) : null,
    });
  });

  return out;
}

async function fetchTier(tier, deps) {
  var impl = (deps && deps.fetchImpl) || fetcher.requestText;
  var res = await impl(BASE + tier.path, { timeoutMs: TIMEOUT });
  var html = await res.text();
  return parseLegends(html);
}

async function handle(event, deps) {
  deps = deps || {};
  var now = (deps.now || Date.now)();
  if (cache.data && now - cache.at < CACHE_TTL) {
    return { ok: true, kind: "ok", message: "", data: cache.data, cached: true };
  }

  var results = await Promise.all(TIERS.map(function (t) {
    // 单个段位失败不影响其它段位
    return fetchTier(t, deps).catch(function () { return null; });
  }));

  var tiers = [];
  TIERS.forEach(function (t, i) {
    if (results[i] && results[i].length) {
      tiers.push({ key: t.key, label: t.label, legends: results[i] });
    }
  });

  // 一个都没解析出来 → 当失败。宁可不显示，也不给一个空列表
  if (!tiers.length) return { ok: false, kind: "http", message: "选取率数据暂时取不到。" };

  var data = { tiers: tiers };
  cache = { at: now, data: data };
  return { ok: true, kind: "ok", message: "", data: data, cached: false };
}

module.exports = {
  handle: handle,
  parseLegends: parseLegends,
  translateLegend: translateLegend,
  LEGEND_CN: LEGEND_CN,
  TIERS: TIERS,
  CACHE_TTL: CACHE_TTL,
  _clearCache: function () { cache = { at: 0, data: null }; },
};
