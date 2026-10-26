/**
 * 职业热门组合（ALGS 赛事口径）—— 抓上游 ALGS 赛事页解析。
 *
 * 数据来自 `/algs/<年-赛季>/<联赛>/Global/Overview` 里的「Teams Compositions data」表，
 * 每行是一个三人组合 + 选取率 / 平均名次 / 胜率 / 前五率 / FWR / 出现次数。
 *
 * 为什么不走 API：
 *   - 主 API（api.apexlegendsstatus.com）里没有赛事数据
 *   - 页面上那些 `/algs/competitive-meta`、`/algs/game/<hash>` 有 Cloudflare 人机校验（403），**碰不得**
 *   - 但 `/algs`、`/algs/<赛事>/Global/Overview`、`/algs/bans-stats` 是**公开可访问**的，
 *     且站点 robots.txt 是 `Allow: /` —— 所以走这些页面
 *
 * 风险与防守（和 pickrates.js 同一套原则）：
 *   解析失败 → **整块不显示**，绝不返回空数组（空数组会被读成"没有热门组合"，是假数据）
 */

var fetcher = require("./fetcher");
var pickrates = require("./pickrates");   // 复用英雄译名表

var BASE = "https://apexlegendsstatus.com";
var TIMEOUT = 10000;
var CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 小时。赛事数据比赛日才变，抓太勤没意义
var MAX_COMPS = 15;                   // 只留最热的前 15 个组合，页面才不会长得离谱

var cache = { at: 0, data: null };

/** 赛区中文名。职业组合是按赛区统计的，界面要说清数据来自哪个赛区，不能含糊。
 *  上游真实用的码是 Global / APAC_N / APAC_S / EMEA / NA / SA（下划线）。 */
var REGION_CN = {
  Global: "全球",
  APAC_S: "亚太南部",
  APAC_N: "亚太北部",
  EMEA: "欧洲中东",
  NA: "北美",
  SA: "南美",
  Japan: "日本",
  Korea: "韩国",
  China: "中国",
  // 兼容带连字符/全称的写法
  "APAC-South": "亚太南部",
  "APAC-North": "亚太北部",
  "South-America": "南美"
};

function regionCn(region) {
  return REGION_CN[region] || region || "";
}

/** 赛区英文名。界面切英文时用它 —— 只给中文的话英文模式下会露出「欧洲中东」。 */
var REGION_EN = {
  Global: "Global",
  APAC_S: "APAC South",
  APAC_N: "APAC North",
  EMEA: "EMEA",
  NA: "North America",
  SA: "South America",
  Japan: "Japan",
  Korea: "Korea",
  China: "China",
  "APAC-South": "APAC South",
  "APAC-North": "APAC North",
  "South-America": "South America"
};

function regionEn(region) {
  return REGION_EN[region] || region || "";
}

/** "45%" → 45，"10.1" → 10.1，"1,234" → 1234，认不出来返回 null */
function num(text) {
  if (text == null) return null;
  var s = String(text).replace(/%/g, "").replace(/,/g, "").trim();
  if (!s) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}

/**
 * 从 /algs/ 首页收集赛事候选，排序规则（越靠前越优先）：
 *   1. 年份 / 赛季 降序（最新的在前）
 *   2. **Global 赛区优先**（国际大赛的数据最能代表职业环境，地区预选赛参考价值低）
 *   3. 赛事级别：Championships / Playoffs > Pro-League / Open > 其它
 *
 * 链接形如 `/algs/Y6-Split1/ALGS-Playoffs/Global/Overview`。
 * 注意：`/algs`（不带斜杠）会 301 跳转，而我们的 fetcher 不跟随跳转，所以必须用 `/algs/`。
 * @returns {Array<{year:number, split:number, league:string, region:string, path:string}>}
 */
function prestige(league) {
  if (/Championships|Playoffs/i.test(league)) return 3;
  if (/Pro-League|ALGS-Open/i.test(league)) return 2;
  return 1;
}

/**
 * 赛区优先级：**看这套数据对国内玩家有多大参考价值**。
 * 全球大赛最有代表性；其次亚太南部（中国战队所在的赛区）；再是亚太其它；最后欧美。
 */
function regionRank(region) {
  var r = String(region == null ? "" : region);
  if (/^global$/i.test(r)) return 4;
  if (/apac[_-]?s/i.test(r)) return 3;                  // 亚太南部 = 中国战队所在赛区
  if (/apac|japan|korea|china/i.test(r)) return 2;
  return 1;
}

function parseTournaments(html) {
  var seen = {};
  var out = [];
  var re = /\/algs\/(Y(\d+))-Split(\d+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/Overview/g;
  var m;
  while ((m = re.exec(String(html == null ? "" : html))) !== null) {
    var path = "/algs/" + m[1] + "-Split" + m[3] + "/" + m[4] + "/" + m[5] + "/Overview";
    if (seen[path]) continue;
    seen[path] = 1;
    out.push({
      year: Number(m[2]),
      split: Number(m[3]),
      league: m[4],
      region: m[5],
      path: path,
      regionRank: regionRank(m[5]),
      rank: prestige(m[4])
    });
  }
  out.sort(function (a, b) {
    return (b.year - a.year) || (b.split - a.split) || (b.regionRank - a.regionRank) || (b.rank - a.rank);
  });
  return out;
}

/**
 * 解析「Teams Compositions data」表。
 *
 * 每行长这样（真实结构）：
 *   <tr><td><p><img/><img/><img/>&nbsp;&nbsp;&nbsp;Caustic, Sparrow, Wraith</p></td>
 *       <td>45%</td><td>10.1</td><td>0%</td><td>33.3%</td><td>0%</td><td>54.8%</td><td>9</td></tr>
 *
 * 表头顺序：Legend | Pick rate% | Avg. placement | Win Rate% | Top 5 Rate% |
 *           Top 7 Conversion Rate% | FWR% | Total occurrences
 *
 * 列数不足 8 或英雄名解析不出来的行**直接跳过**（宁可少几条，也不要错的）。
 */
function parseComps(html) {
  var out = [];
  var body = String(html == null ? "" : html).match(/<tbody[^>]*id="teamCompositionBody"[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!body) return out;

  var rows = body[1].split(/<tr\b/i).slice(1);
  rows.forEach(function (r) {
    var tds = [];
    var re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var m;
    while ((m = re.exec(r)) !== null) tds.push(m[1]);
    if (tds.length < 8) return;

    // 第一个单元格：三个英雄图标 + 名字串（去标签就是 "Caustic, Sparrow, Wraith"）
    var raw = tds[0].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
    var nameText = raw.replace(/\s+/g, " ").trim();
    if (!nameText) return;

    // 拆分并逐个译成中文（译不到的保留英文）
    var legends = nameText.split(/\s*,\s*/).filter(Boolean).map(function (en) {
      return { name: pickrates.translateLegend(en) || en, nameEn: en };
    });
    if (!legends.length) return;

    out.push({
      legends: legends,
      // 供界面直接显示的中文组合名，如 "侵蚀 + 琉雀 + 恶灵"
      text: legends.map(function (l) { return l.name; }).join(" + "),
      pickRate: num(tds[1]),
      avgPlace: num(tds[2]),
      winRate: num(tds[3]),
      top5Rate: num(tds[4]),
      occurrences: num(tds[7])
    });
  });

  // 最热的排前面：先比出现次数，再比选取率
  out.sort(function (a, b) {
    return ((b.occurrences || 0) - (a.occurrences || 0)) || ((b.pickRate || 0) - (a.pickRate || 0));
  });
  return out;
}

async function getText(path, deps) {
  var impl = (deps && deps.fetchImpl) || fetcher.requestText;
  var res = await impl(BASE + path, { timeoutMs: TIMEOUT });
  return res.text();
}

async function handle(event, deps) {
  deps = deps || {};
  var now = (deps.now || Date.now)();
  if (cache.data && now - cache.at < CACHE_TTL) {
    return { ok: true, kind: "ok", message: "", data: cache.data, cached: true };
  }

  // 1) 找最新赛事。首页拿不到就直接失败（宁可不显示）
  var indexHtml;
  try {
    indexHtml = await getText("/algs/", deps);
  } catch (e) {
    return { ok: false, kind: "http", message: "职业赛事数据暂时取不到。" };
  }

  var tours = parseTournaments(indexHtml);
  if (!tours.length) return { ok: false, kind: "http", message: "职业赛事列表解析失败。" };

  // 2) 从最优先的往后试，第一个能解析出组合的就用
  //    （新赛季还没开打时，那个赛事的页面没有组合表，会自动回退到上一届）
  var picked = null;
  for (var i = 0; i < Math.min(tours.length, 5); i++) {
    var t = tours[i];
    try {
      var html = await getText(t.path, deps);
      var comps = parseComps(html);
      if (comps.length) { picked = { tour: t, comps: comps }; break; }
    } catch (e) { /* 换下一个 */ }
  }
  if (!picked) return { ok: false, kind: "http", message: "职业组合数据暂时取不到。" };

  var data = {
    event: {
      label: "Y" + picked.tour.year + " Split" + picked.tour.split + " · " + picked.tour.league,
      region: regionCn(picked.tour.region),
      // 英文赛区名也带上：界面按语言二选一，否则英文模式下会露出「欧洲中东」
      regionEn: regionEn(picked.tour.region),
      path: picked.tour.path,
      total: picked.comps.length
    },
    comps: picked.comps.slice(0, MAX_COMPS)
  };
  cache = { at: now, data: data };
  return { ok: true, kind: "ok", message: "", data: data, cached: false };
}

module.exports = {
  handle: handle,
  parseTournaments: parseTournaments,
  parseComps: parseComps,
  regionCn: regionCn,
  regionRank: regionRank,
  MAX_COMPS: MAX_COMPS,
  CACHE_TTL: CACHE_TTL,
  _clearCache: function () { cache = { at: 0, data: null }; },
};
