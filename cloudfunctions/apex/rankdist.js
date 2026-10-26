/**
 * 段位分布 —— 从上游的 **JSON 接口**取，不是抓 HTML。这是本轮找到的最好用的一条数据。
 *
 * 端点是网页自己在用的那个（`/game-stats/ranked-distribution` 页面里
 * `$.getJSON("/lib/php/rankdistrib.php?unranked=yes")`）：
 *   GET https://apexlegendsstatus.com/lib/php/rankdistrib.php?unranked=yes
 * 返回一个数组：
 *   [0]            {name:"Rank", data:["Rookie IV", ..., "Apex Predator"]}   ← 26 个小段
 *   [1] ~ [26]     {name, color, data:[一位是百分比、其余是 0 的稀疏数组], totalCount}
 * 也就是**每个小段的人数占比 + 绝对人数**，样本约 57 万账号。
 *
 * 为什么这条比别的值钱：
 *   · 是 JSON 不是 HTML —— 结构变了也不会像解析 HTML 那样静默解析出垃圾；
 *   · 体积极小（3.5 KB），云函数一次抓取不到 100 毫秒；
 *   · **它没被人机校验挡**（实测非浏览器 UA 直接 200）。同站的 /leaderboard、
 *     /live-ranked-leaderboards、/algs/* 都是 403，所以这一条是能实时拿的，
 *     不用像 ALGS 那样做离线快照。
 *
 * ⚠️ 口径（必须原样告诉用户，不能含糊）：这是**这个网站自己账号库里**的分布，
 *    不是官方发布的全量段位分布；只含有排位记录的账号。
 */

var fetcher = require("./fetcher");

var BASE = "https://apexlegendsstatus.com";
var PATH = "/lib/php/rankdistrib.php?unranked=yes";
var TIMEOUT = 8000;
var CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 小时。上游按天更新，抓太勤是给人添负担

var cache = { at: 0, data: null };

/** "Rookie IV" / "Apex Predator" / "Master" → 大段名 */
function bigTier(name) {
  var s = String(name == null ? "" : name).trim();
  if (!s) return "";
  if (/^apex\s+predator$/i.test(s)) return "Apex Predator";
  if (/^master$/i.test(s)) return "Master";
  var m = s.match(/^(Rookie|Bronze|Silver|Gold|Platinum|Diamond)\s+(IV|III|II|I)$/i);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  // 认不出的原样返回，绝不猜 —— 上游加了新段位时界面上能立刻看出来
  return s;
}

/**
 * 解析接口返回的 JSON。
 *
 * 那个稀疏数组 `data` 只有一格有值（自己那一格），取第一个非零即可 ——
 * 不要按下标去索引：下标是"对比用的另一段位"，不是同一回事。
 *
 * @param {any} json 接口原文（数组）
 * @returns {{total:number, tiers:Array}|null} 解析不出东西返回 null
 */
function parseDistrib(json) {
  if (!Array.isArray(json) || json.length < 2) return null;
  var names = (json[0] && json[0].data) || [];

  var sub = [];
  for (var i = 1; i < json.length; i++) {
    var s = json[i] || {};
    var arr = s.data || [];
    var pct = 0;
    for (var k = 0; k < arr.length; k++) {
      if (arr[k]) { pct = Number(arr[k]) || 0; break; }
    }
    var name = String(s.name || names[i - 1] || "").trim();
    if (!name) continue;
    sub.push({ tier: name, big: bigTier(name), pct: pct, players: Number(s.totalCount) || 0 });
  }
  if (!sub.length) return null;

  // 按上游给的顺序分组（上游就是按段位从低到高排的，别再自己排一遍）
  var tiers = [];
  var index = {};
  sub.forEach(function (r) {
    var key = r.big || r.tier;
    if (!Object.prototype.hasOwnProperty.call(index, key)) {
      index[key] = tiers.length;
      tiers.push({ key: key, pct: 0, players: 0, subs: [] });
    }
    var t = tiers[index[key]];
    t.pct += r.pct;
    t.players += r.players;
    t.subs.push({ tier: r.tier, pct: r.pct, players: r.players });
  });
  tiers.forEach(function (t) { t.pct = Math.round(t.pct * 1000) / 1000; });

  var total = tiers.reduce(function (a, t) { return a + t.players; }, 0);
  return { total: total, tiers: tiers };
}

async function handle(event, deps) {
  deps = deps || {};
  var now = (deps.now || Date.now)();
  if (cache.data && now - cache.at < CACHE_TTL) {
    return { ok: true, kind: "ok", message: "", data: cache.data, cached: true };
  }

  var impl = deps.fetchImpl || fetcher.requestText;
  var res = await impl(BASE + PATH, { timeoutMs: TIMEOUT });
  if (!res || !res.ok) {
    return { ok: false, kind: "http", message: "段位分布暂时取不到。" };
  }

  var parsed = null;
  try {
    parsed = parseDistrib(JSON.parse(await res.text()));
  } catch (e) {
    parsed = null;
  }
  // 解析不出来 → 当失败。绝不给一个空分布或者全 0（那会被读成"没人打排位"）
  if (!parsed) return { ok: false, kind: "http", message: "段位分布暂时取不到。" };

  var data = {
    updatedAt: now,
    total: parsed.total,
    totalText: parsed.total,
    tiers: parsed.tiers
  };
  cache = { at: now, data: data };
  return { ok: true, kind: "ok", message: "", data: data, cached: false };
}

module.exports = {
  handle: handle,
  parseDistrib: parseDistrib,
  bigTier: bigTier,
  PATH: PATH,
  CACHE_TTL: CACHE_TTL,
  _clearCache: function () { cache = { at: 0, data: null }; }
};
