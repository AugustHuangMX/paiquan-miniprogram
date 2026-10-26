/**
 * 小程序端纯逻辑。
 *
 * 这里只放不依赖 wx.* API 的部分：归一化、格式化、错误分类。
 * 好处是能在 Node 里直接跑单元测试 —— 上游那些字段名和返回形态
 * 已经坑过很多次，全靠这些断言守住。
 *
 * 用 CommonJS（小程序原生支持），云端云函数也复用同一套分类规则。
 */

/* ============================================================
   常量
   ============================================================ */

// 四种模式。上游改过字段名（arenas 已废弃），所以每个模式配一组候选键。
var MODES = [
  { id: "ranked",   label: "排位赛地图",   tag: "BR Ranked", keys: ["ranked", "ranked_br", "br_ranked"] },
  { id: "pubs",     label: "匹配模式地图", tag: "BR Pubs",   keys: ["battle_royale", "pubs", "br"] },
  { id: "mixtape",  label: "轮换模式地图", tag: "Mixtape",   keys: ["ltm", "mixtape", "control"] },
  { id: "wildcard", label: "外卡模式地图", tag: "Wildcard",  keys: ["wildcard", "wild_card"] }
];

var PLATFORMS = [
  { code: "PC",     label: "PC" },
  { code: "PS4",    label: "PlayStation" },
  { code: "X1",     label: "Xbox" },
  { code: "SWITCH", label: "Switch" }
];

// 每张地图一种颜色。小程序里不能用外部图片（图片域名也要备案，
// 而且那是别人站点的素材，有版权问题），所以用配色区分。
var MAP_TINT = {
  "World's Edge": "#c1440e",
  "Olympus": "#5b8dd6",
  "Kings Canyon": "#c9a227",
  "Storm Point": "#2f9e8f",
  "Broken Moon": "#8b5cf6",
  "E-District": "#e0353a"
};

var VERIFY_URL = "https://portal.apexlegendsapi.com/discord-auth";

var MSG = {
  badkey: "API Key 无效或已失效，请联系维护者检查云函数配置。",
  unverified: "数据源的 Key 还没激活：需要先绑定 Discord 账号。请到 " + VERIFY_URL + " 完成验证。",
  ratelimit: "请求太频繁，请稍后再试。",
  notfound: "查无此人。请核对 ID（区分大小写与特殊符号），并确认平台选对了。",
  empty: "数据源返回了空内容（上游偶发如此），请稍后重试。",
  nokey: "云函数还没配置 API Key，请在云开发控制台为本云函数设置环境变量 ALS_API_KEY。",
  action: "不认识的请求类型。"
};

/* ============================================================
   格式化
   ============================================================ */

function pad2(n) { return n < 10 ? "0" + n : String(n); }

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
}

function fmtClock(epochSec) {
  if (!epochSec) return "--:--";
  var d = new Date(epochSec * 1000);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/**
 * 「多久以前」的文字。
 * @param ts   要描述的毫秒时间戳
 * @param nowMs 参考时间（毫秒）；不传就用当前时间。
 *              可注入是为了能确定性地测 —— 否则测出来的东西依赖真实时钟。
 */
function fmtAgo(ts, nowMs) {
  if (!ts) return "尚未更新";
  var now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();
  var s = Math.floor((now - ts) / 1000);
  if (s < 5) return "刚刚更新";
  if (s < 60) return s + " 秒前更新";
  var m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前更新";
  return Math.floor(m / 60) + " 小时前更新";
}

function num(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  var s = String(Math.round(n));
  var out = "";
  var c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    c++;
    if (c % 3 === 0 && i > 0 && s.charAt(i - 1) !== "-") out = "," + out;
  }
  return out;
}

function tintOf(name) {
  if (!name) return "#e0353a";
  if (MAP_TINT[name]) return MAP_TINT[name];
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return "hsl(" + h + ",58%,62%)";
}

/* ============================================================
   地图轮换归一化
   ============================================================ */

function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

// 上游可能返回 null / 数组 / 字符串，这里必须兜住，否则整页崩掉
function pickMode(raw, keys) {
  if (!isObj(raw)) return null;
  for (var i = 0; i < keys.length; i++) {
    var v = raw[keys[i]];
    if (isObj(v) && (v.current || v.next)) return v;
  }
  return null;
}

/**
 * 地图名中文对照。
 *
 * 上游接口只给英文名，而中文客户端里显示的是中文，对不上用户就会困惑。
 *
 * 名字来源与核对状态：
 *   · 六张**大逃杀地图** —— 已由用户对着游戏逐一核对过，别再"顺手改回去"
 *   · **其它模式的据点名** —— 取自萌娘百科的「其它模式地图」列表（同一来源）
 *   · 列表里**找不到的据点一律不收录**，界面会退回显示英文。
 *     宁可显示英文，也不能编一个错的中文名 —— 错的译名会让人以为是另一个地方。
 *
 * 好消息：这张表在云函数里也用同一份，所以改译名只要部署云函数，
 * **不用重新提审小程序**。
 */
var MAP_CN = {
  // ---- 大逃杀地图（已核对）----
  "Kings Canyon": "诸王峡谷",
  "World's Edge": "世界尽头",
  "Olympus": "奥林匹斯",
  "Storm Point": "风暴点",
  "Broken Moon": "残月",
  "E-District": "电力区域",
  // ---- 其它模式（控制 / 团队死斗 / 竞技场 / 轮换等）用的小地图 ----
  // 这些是各地图里的**具体地点**，轮换模式（Mixtape：Control / Gun Run / TDM）轮流用它们。
  // 漏一个界面上就会出现一个英文名（用户在中文模式下看到 "Monument" 就是这个原因）。
  // 只写核对过的译名 —— 猜错的名字比没有更糟。
  "Caustic Treatment": "侵蚀疗法",
  "Skulltown": "骷髅镇",
  "Hammond Labs": "哈蒙德实验室",
  "Lava Siphon": "熔岩虹吸",
  "Fragment": "碎片",
  "Fragment East": "碎片东部",
  "Fragment West": "碎片西部",
  "Barometer": "晴雨表",
  "Dome": "穹顶",
  "The Dome": "穹顶",
  "Artillery": "火炮",
  "Estates": "不动产",
  "Habitat 4": "栖息地4",
  "Party Crasher": "派对破坏者",
  "Phase Runner": "相位穿梭器",
  "Highpoint": "高墙",
  "Monument": "纪念碑",
  "Thunderdome": "雷霆穹顶",
  "ZEUS Station": "宙斯站",
  "Production Yard": "生产场地",
  "Wattson's Treatment": "沃特森的塔"
};

// 预先建一份小写索引，"broken moon" 和 "BROKEN MOON" 都能命中
var MAP_CN_LOWER = {};
Object.keys(MAP_CN).forEach(function (k) { MAP_CN_LOWER[k.toLowerCase()] = MAP_CN[k]; });

/**
 * @param {string} name 上游给的英文地图名
 * @returns {string} 中文名；查不到返回空串（调用方应退回英文原文）
 */
function translateMapName(name) {
  if (name == null) return "";
  var key = String(name).trim().toLowerCase();
  if (!key) return "";
  var hit = MAP_CN_LOWER[key];
  if (hit) return hit;
  // 上游对同一张图有时写 "Dome"、有时写 "The Dome"，去掉冠词再查一次 ——
  // 否则同一张图会出现"有时中文有时英文"这种最难查的 bug。
  if (key.indexOf("the ") === 0) return MAP_CN_LOWER[key.slice(4)] || "";
  return "";
}

function toEntry(o) {
  if (!isObj(o)) return null;
  var map = o.map || o.mapName || o.name || "";
  if (!map) return null;
  var start = Number(o.start) || 0;
  var end = Number(o.end) || 0;
  if (!end && o.remainingSecs && start) end = start + Number(o.remainingSecs);
  return {
    map: String(map),
    // 中文译名。界面显示 mapCn || map，所以查不到也不会空白。
    mapCn: translateMapName(map),
    start: start,
    end: end,
    // 轮换模式 15 分钟一场，光有地图名不够，玩法（TDM / Control / Gun Run）才是关键
    eventName: o.eventName ? String(o.eventName) : "",
    // 地图配图地址。小程序端用不上（图片域名要备案，加载不了），
    // 但网页版要靠它显示配图 —— 归一化层两端共用，所以必须原样保留。
    asset: o.asset ? String(o.asset) : ""
  };
}

function normalizeRotation(raw) {
  return MODES.map(function (m) {
    var block = pickMode(raw, m.keys);
    if (!block) return { def: m, current: null, nexts: [] };
    var nextRaw = block.next;
    var list = Array.isArray(nextRaw) ? nextRaw : (nextRaw ? [nextRaw] : []);
    return {
      def: m,
      current: toEntry(block.current),
      nexts: list.map(toEntry).filter(Boolean)
    };
  });
}

/**
 * 找出"看起来是地图轮换、但我们不认识"的顶层字段。
 * 上游改名真实发生过（arenas 被废弃）。真碰上时用户只会看到
 * 四张"当前未开启"干瞪眼，所以必须点名报出来。
 */
function unknownModeKeys(raw) {
  if (!isObj(raw)) return [];
  var known = {};
  MODES.forEach(function (m) { m.keys.forEach(function (k) { known[k] = true; }); });
  return Object.keys(raw).filter(function (k) {
    if (known[k]) return false;
    var v = raw[k];
    return isObj(v) && !!(v.current || v.next);
  });
}

/** 空数组 / 空对象 / null 这类"答了但什么都没答"的响应 */
function isUselessPayload(raw) {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return true;
  return Object.keys(raw).length === 0;
}

/* ============================================================
   猎杀分数线归一化
   ============================================================ */

function looksLikePredEntry(o) {
  if (!isObj(o)) return false;
  // 真实响应里分数线叫 val，另带 foundRank / totalMastersAndPreds；
  // 早期形态用 RP / rankScore。两边都认，否则真实数据会被判成"不是平台条目"。
  return o.RP != null || o.rp != null || o.rankScore != null || o.points != null ||
         o.val != null || o.totalMastersAndPreds != null || o.foundRank != null;
}

function pickNum(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = o[keys[i]];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
  }
  return null;
}

/**
 * 上游的时间戳 → 毫秒。
 *
 * 实测 /predator 的 updateTimestamp 是**秒**（1790589929）。但这类字段上游换过单位，
 * 所以大于 1e12 的一律当毫秒。取不到或不合理就给 null ——
 * **绝不能退化成「现在」**：那会让界面显示"刚刚更新"，而实际数据可能是几天前的。
 */
function toEpochMs(v) {
  var n = (typeof v === "number") ? v
        : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) ? Number(v)
        : NaN;
  if (!isFinite(n) || n <= 0) return null;
  if (n > 1e12) return n;          // 已经是毫秒
  if (n > 1e9) return n * 1000;    // 秒（1e9 秒 ≈ 2001 年，比这小的不是合法时间戳）
  return null;
}

function normalizePredator(raw) {
  if (!isObj(raw)) return null;

  function buildPlats(obj) {
    var plats = [];
    PLATFORMS.forEach(function (p) {
      var e = obj[p.code];
      if (!looksLikePredEntry(e)) return;
      var predCount = pickNum(e, ["foundRank"]);
      plats.push({
        code: p.code,
        label: p.label,
        rp: pickNum(e, ["val", "RP", "rp", "rankScore", "points"]),
        masters: pickNum(e, ["totalMastersAndPreds", "mastersAndPreds", "masters", "totalMasters"]),
        // foundRank = 踩在分数线上的名次 = 该平台猎杀段位人数；-1 表示没取到
        predCount: (predCount != null && predCount > 0) ? predCount : null,
        // 上游这份数据是什么时候刷新的（不是我们什么时候取的）
        updatedAt: toEpochMs(e.updateTimestamp)
      });
    });
    return plats;
  }

  // 情况一：顶层直接就是 { PC:{...}, X1:{...} }
  var topLevel = buildPlats(raw);
  if (topLevel.length) return { key: "root", plats: topLevel };

  // 情况二：分组结构。真实响应是 { RP:{ PC:{...} } }，早期是 { ranked:{...} }
  var PRIORITY = ["ranked", "RP", "rp", "battle_royale"];
  var groups = [];
  Object.keys(raw).forEach(function (k) {
    if (!isObj(raw[k])) return;
    var plats = buildPlats(raw[k]);
    if (plats.length) groups.push({ key: k, plats: plats });
  });
  function rank(k) { var i = PRIORITY.indexOf(k); return i < 0 ? 99 : i; }
  groups.sort(function (a, b) { return rank(a.key) - rank(b.key); });
  return groups.length ? groups[0] : null;
}

/* ============================================================
   猎杀底分涨幅（较昨日同期）
   ============================================================ */

// 基准快照允许的时间窗口：20~28 小时前。
// 太近不叫"昨日"，太远就不是"同期"了 —— 宁可不算，也不给一个语义含混的数字。
var DELTA_MIN_AGE_MS = 20 * 3600 * 1000;
var DELTA_MAX_AGE_MS = 28 * 3600 * 1000;

/** 这条基准快照的时间是否落在可用窗口内 */
function basisUsableAt(at, nowMs) {
  if (typeof at !== "number" || !isFinite(at)) return false;
  if (typeof nowMs !== "number" || !isFinite(nowMs)) return false;
  var age = nowMs - at;
  return age >= DELTA_MIN_AGE_MS && age <= DELTA_MAX_AGE_MS;
}

/**
 * 把「较昨日同期涨了多少」贴到每个平台上。
 *
 * @param group  normalizePredator 的结果
 * @param basis  { at: 毫秒, plats: { PC: { rp } } }，或 null（库里还没数据）
 * @param nowMs  现在的毫秒时间戳
 *
 * 任何一边缺失/不可用 → 该平台 delta 为 null，界面据此**不显示那一行**。
 * 底分下跌时照实返回负数（赛季重置真会掉），不藏。
 */
function attachPredatorDeltas(group, basis, nowMs) {
  if (!group || typeof group !== "object") return group || null;
  if (!Array.isArray(group.plats)) return group;

  var usable = !!(basis && basis.plats && basisUsableAt(basis.at, nowMs));
  group.plats.forEach(function (p) {
    p.delta = null;
    p.deltaBasisAt = null;
    if (!usable) return;
    var b = basis.plats[p.code];
    if (!b) return;
    var from = (typeof b.rp === "number" && isFinite(b.rp) && b.rp > 0) ? b.rp : null;
    var now = (typeof p.rp === "number" && isFinite(p.rp) && p.rp > 0) ? p.rp : null;
    if (from == null || now == null) return;
    p.delta = now - from;
    p.deltaBasisAt = basis.at;
  });
  return group;
}

/* ============================================================
   服务器状态
   ============================================================ */

// 分组名 → 中文。上游给的是 Origin_login 这种内部代号，直接甩给用户没人看得懂。
var SERVER_GROUPS = [
  { key: "Origin_login",        label: "登录服务" },
  { key: "EA_novafusion",       label: "游戏核心" },
  { key: "EA_accounts",         label: "EA 账号" },
  { key: "ApexOauth_Crossplay", label: "跨平台联机" }
];

// otherPlatforms 里的键不是大区，是两家主机的网络，单独列成一行。
var PLATFORM_NETWORKS = [
  { key: "Playstation-Network", label: "PlayStation 网络" },
  { key: "Xbox-Live",           label: "Xbox Live" }
];

// selfCoreTest 刻意不展示：那是数据源自己网站/接口的探测，
// 它挂了我们这边的兜底提示已经说明了原因，对玩家没有参考价值。

var REGION_CN = {
  "EU-West": "欧洲西部", "EU-East": "欧洲东部",
  "US-West": "美西", "US-Central": "美中", "US-East": "美东",
  "SouthAmerica": "南美", "Asia": "亚洲"
};

// 严重程度：DOWN > SLOW > UNKNOWN > UP。有明确故障时优先报故障。
var STATUS_RANK = { DOWN: 3, SLOW: 2, UNKNOWN: 1, UP: 0 };

/**
 * 状态值归一化。
 * 关键点：**没见过的状态一律归到 UNKNOWN，绝不能当成正常** ——
 * 上游换了写法而我们满屏显示绿色，是这块最坏的结果。
 */
function normStatus(v) {
  var s = String(v == null ? "" : String(v)).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, s) ? s : "UNKNOWN";
}

function regionLabel(key) { return REGION_CN[key] || String(key); }

function readOne(entry) {
  if (!isObj(entry)) return null;
  return {
    status: normStatus(entry.Status),
    // 有些分组（主机网络）根本没有 ResponseTime，那就如实给 null，不编 0
    ms: (typeof entry.ResponseTime === "number" && isFinite(entry.ResponseTime)) ? entry.ResponseTime : null,
    // 这次探测是什么时候做的（上游给的是秒）
    at: toEpochMs(entry.QueryTimestamp)
  };
}

function sealGroup(key, label, regions) {
  if (!regions.length) return null;
  var status = "UP";
  var ms = null;
  regions.forEach(function (r) {
    if (STATUS_RANK[r.status] > STATUS_RANK[status]) status = r.status;
    // 取最慢的那个：要看最坏情况
    if (r.ms != null && (ms == null || r.ms > ms)) ms = r.ms;
  });
  return {
    key: key,
    label: label,
    status: status,
    ms: ms,
    regions: regions,
    trouble: regions.filter(function (r) { return r.status !== "UP"; })
  };
}

/**
 * /servers 的原始响应 → 分组列表。
 * 拿不到任何可用数据时返回 null，界面据此整块不显示。
 */
function normalizeServers(raw) {
  if (!isObj(raw)) return null;

  var groups = [];

  SERVER_GROUPS.forEach(function (g) {
    var obj = isObj(raw[g.key]) ? raw[g.key] : null;
    if (!obj) return;
    var regions = [];
    Object.keys(obj).forEach(function (rk) {
      var one = readOne(obj[rk]);
      if (one) regions.push({ key: rk, label: regionLabel(rk), status: one.status, ms: one.ms });
    });
    var sealed = sealGroup(g.key, g.label, regions);
    if (sealed) groups.push(sealed);
  });

  var others = isObj(raw.otherPlatforms) ? raw.otherPlatforms : null;
  if (others) {
    PLATFORM_NETWORKS.forEach(function (p) {
      var one = readOne(others[p.key]);
      if (!one) return;
      groups.push(sealGroup(p.key, p.label, [{ key: p.key, label: p.label, status: one.status, ms: one.ms, at: one.at }]));
    });
  }

  if (!groups.length) return null;

  var summary = { up: 0, slow: 0, down: 0, unknown: 0, problem: 0, total: groups.length };
  // 所有区域里最新的一次探测时间 —— 界面用它说明"这份状态是什么时候探的"。
  // 取最新而不是最旧：同一次探测各区域只差几秒，用一个值代表整块就够了。
  var queriedAt = null;
  groups.forEach(function (g) {
    g.regions.forEach(function (r) {
      if (r.at != null && (queriedAt == null || r.at > queriedAt)) queriedAt = r.at;
    });
    if (g.status === "UP") { summary.up++; return; }
    // 「异常」= 任何不是 UP 的行，包含未知状态
    summary.problem++;
    if (g.status === "SLOW") summary.slow++;
    else if (g.status === "DOWN") summary.down++;
    else summary.unknown++;
  });

  // 上游加了新分组要透出来，否则那一行会无声消失、没人发现
  var known = { otherPlatforms: true, selfCoreTest: true };
  SERVER_GROUPS.forEach(function (g) { known[g.key] = true; });
  var unknown = Object.keys(raw).filter(function (k) { return !known[k]; });

  return { summary: summary, groups: groups, unknown: unknown, queriedAt: queriedAt };
}

/* ============================================================
   战绩：追踪器名字翻译
   ============================================================ */

/**
 * 上游给的追踪器名字是英文（"BR Kills"、"BR Season 12 kills"…），而且很杂。
 * 按关键词翻译：上游加新追踪器时关键词通常还在，比逐个枚举名字稳。
 * 认不出来就原样显示英文，总比丢掉好 —— 数据比好看重要。
 */
function translateTracker(name, key) {
  var n = String(name || "").trim();
  var k = String(key || "").trim();
  var season = /Season\s*(\d+)/i.exec(n);
  var base = "";
  if (/Headshots?/i.test(n)) base = "爆头";
  else if (/Kills?/i.test(n)) base = "击杀";
  else if (/Damage/i.test(n)) base = "伤害";
  else if (/Wins?/i.test(n)) base = "吃鸡";
  else if (/Games|Matches/i.test(n)) base = "场次";
  else if (/Shields?\s*charged/i.test(n)) base = "护盾充能";
  else return n || k;
  return (season ? "第" + season[1] + "赛季" : "生涯") + base;
}

/** 排序权重：越常见的越靠前，别让冷门数据把位置占掉 */
function highlightRank(label) {
  if (label === "生涯击杀") return 0;
  if (label === "生涯伤害") return 1;
  if (label === "生涯爆头") return 2;
  if (label === "生涯吃鸡") return 3;
  if (label.indexOf("生涯") === 0) return 4;          // 其它生涯类，仍排在赛季类前面
  if (/^第\d+赛季/.test(label)) return 5;
  if (/^[\u4e00-\u9fff]/.test(label)) return 6;       // 翻译出来了但比较冷门
  return 9;                                           // 没翻译出来，放最后
}

var HIGHLIGHT_LIMIT = 8;

function buildHighlights(total) {
  if (!isObj(total)) return [];
  var items = [];
  Object.keys(total).forEach(function (k) {
    var t = total[k];
    if (!isObj(t)) return;
    var v = (typeof t.value === "number") ? t.value
          : (t.value != null && isFinite(Number(t.value))) ? Number(t.value) : null;
    if (v == null) return;
    var label = translateTracker(t.name, k);
    // labelEn 是上游原名（英文）。界面按语言二选一 ——
    // 只留中文 label 的话，切到英文后生涯数据条目会全是中文。
    items.push({
      label: label,
      labelEn: (String(t.name || "").trim() || String(k).trim()),
      value: v,
      rank: highlightRank(label)
    });
  });

  items.sort(function (a, b) { return a.rank - b.rank || b.value - a.value; });

  // 同一个标签可能来自多个键（上游会在活动和生涯里各放一份），只留最大的那个，
  // 否则页面上会出现两行一模一样的「生涯击杀」。
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (seen[it.label]) continue;
    seen[it.label] = true;
    out.push({ label: it.label, value: it.value, valueText: num(it.value) });
    if (out.length >= HIGHLIGHT_LIMIT) break;
  }
  return out;
}

/* ============================================================
   玩家归一化
   ============================================================ */

/* ============================================================
   玩家 uid：区分同名账号的唯一手段
   ============================================================ */

// EA 的 uid 是纯数字：PC（Origin）大约 10~13 位，主机平台能到 19 位。
// 上下限放宽一些没关系 —— 查询时是"先当名字查、查不到才当 uid 试"，
// 所以把一个纯数字的玩家名误判成 uid，也不会影响他的查询。
var UID_RE = /^\d{6,25}$/;

/** uid 能不能用（取不到就给空串，绝不编一个） */
function normalizeUid(v) {
  if (typeof v === "number" && isFinite(v) && v > 0) v = String(Math.round(v));
  if (typeof v !== "string") return "";
  var s = v.trim();
  return UID_RE.test(s) ? s : "";
}

/** 用户输入看起来像不像 uid（决定查不到名字时要不要再按 uid 试一次） */
function isUidLike(v) {
  if (typeof v === "number") return isFinite(v) && v > 0 && UID_RE.test(String(Math.round(v)));
  if (typeof v !== "string") return false;
  return UID_RE.test(v.trim());
}

function normalizePlayer(raw) {  var g = (isObj(raw) && isObj(raw.global)) ? raw.global : {};
  var rank = isObj(g.rank) ? g.rank : {};
  var posKeys = ["ladderPos", "ladderPosPlatform", "ladderPosGlobal", "rankPos"];
  var pos = null, posKey = "";
  for (var i = 0; i < posKeys.length; i++) {
    var v = rank[posKeys[i]];
    if (typeof v === "number" && v > 0) { pos = v; posKey = posKeys[i]; break; }
  }

  // ---- 在线状态（战绩页要显示"这人现在在不在线、用哪个传奇"）----
  var rt = isObj(raw) && isObj(raw.realtime) ? raw.realtime : null;
  var realtime = rt ? {
    online: !!rt.isOnline,
    inGame: !!rt.isInGame,
    legend: rt.selectedLegend ? String(rt.selectedLegend) : "",
    stateText: rt.currentStateAsText ? String(rt.currentStateAsText)
             : (rt.isOnline ? "在线" : "离线")
  } : null;

  // ---- 封禁状态（被封的号得一眼看出来，否则会以为数据错了）----
  var bans = isObj(g.bans) ? g.bans : {};
  var banned = {
    active: !!bans.isActive,
    reason: bans.isActive ? String(bans.last_banReason || "未知原因") : ""
  };

  return {
    name: g.name || "未知玩家",
    // uid 是唯一能区分同名账号的东西（游戏内 ID 不唯一，Steam 玩家尤其常见）
    uid: normalizeUid(g.uid),
    level: typeof g.level === "number" ? g.level : null,
    levelPrestige: typeof g.levelPrestige === "number" ? g.levelPrestige : null,
    toNextLevelPercent: typeof g.toNextLevelPercent === "number" ? g.toNextLevelPercent : null,
    platform: g.platform || "",
    avatar: g.avatar || "",
    rankName: rank.rankName || "",
    rankDiv: rank.rankDiv != null ? rank.rankDiv : null,
    rankScore: typeof rank.rankScore === "number" ? rank.rankScore : null,
    season: rank.rankedSeason || "",
    ladderPos: pos,
    ladderKey: posKey,
    realtime: realtime,
    banned: banned,
    highlights: buildHighlights(isObj(raw) ? raw.total : null)
  };
}

/* ============================================================
   上游响应分类
   ============================================================ */

// 上游表达"Key 有问题"的方式不止一种，实测到的四种都要认：
//   /maprotation、/predator → 非 JSON 文本 "Error: API key doesn't exist !"
//   /bridge                 → 401 + JSON {"Error":"Invalid API key"}
//   auth 为空               → 竟然返回 200 + 纯文本 "Unauthorized format"
//   没绑 Discord            → 429 + JSON {"Error":"You must verify your API account first..."}
// 最后一种最坑：状态码是 429，照状态码处理会告诉用户"请求太频繁"然后一直重试，
// 而真实原因是 Key 根本没激活。所以必须先看正文，再 fallback 到状态码。
var KEY_PROBLEM = /api key|unauthorized|unknown key/i;
var VERIFY_PROBLEM = /verify your api account|linking your discord|discord-?auth/i;
// 上游表达"查不到这个人"：实测是 404 + {"Error":"Player not found..."}
var NOT_FOUND_RE = /not found|does not exist|no such player|invalid uid|未能找到/i;

/**
 * @param {number} status HTTP 状态码
 * @param {string} text   响应正文
 * @returns {{kind:string, message:string, data?:any}}
 *   kind: ok | badkey | unverified | ratelimit | notfound | empty | http
 */
function classifyUpstream(status, text) {
  var raw = (text == null) ? "" : String(text);
  var data = null, isJson = true;
  try { data = JSON.parse(raw); } catch (e) { isJson = false; }

  if (!isJson) {
    var m = raw.trim().slice(0, 200);
    if (VERIFY_PROBLEM.test(m)) return { kind: "unverified", message: MSG.unverified };
    if (KEY_PROBLEM.test(m)) return { kind: "badkey", message: MSG.badkey };
    return { kind: "http", message: m || ("HTTP " + status) };
  }

  // JSON 形态的错误体（/bridge 走这条）
  var errMsg = "";
  if (isObj(data) && (data.Error || data.error || data.message)) {
    errMsg = String(data.Error || data.error || data.message);
    if (VERIFY_PROBLEM.test(errMsg)) return { kind: "unverified", message: MSG.unverified };
    if (KEY_PROBLEM.test(errMsg)) return { kind: "badkey", message: MSG.badkey };
    // 正文里明说查不到人 → notfound。实测上游是 404，但这里按正文再兜一层，
    // 因为"200 + Error"一旦被当成成功，页面会显示一个叫「未知玩家」的假人
    if (NOT_FOUND_RE.test(errMsg)) return { kind: "notfound", message: MSG.notfound };
    if (status === 429) return { kind: "ratelimit", message: MSG.ratelimit };
    if (status === 404) return { kind: "notfound", message: MSG.notfound };
    if (status >= 400) return { kind: "http", message: errMsg };
    // 状态码正常却带着 Error 字段：上游答了错，绝不能算成功
    return { kind: "http", message: errMsg };
  }

  if (status === 429) return { kind: "ratelimit", message: MSG.ratelimit };
  if (status >= 400) return { kind: "http", message: "HTTP " + status };

  // 200 且是 JSON：还要挡住"答了但什么都没答"的情况
  if (data === null || typeof data !== "object") return { kind: "empty", message: MSG.empty };
  if (isUselessPayload(data)) return { kind: "empty", message: MSG.empty };

  return { kind: "ok", message: "", data: data };
}

module.exports = {
  MODES: MODES,
  PLATFORMS: PLATFORMS,
  MAP_TINT: MAP_TINT,
  MAP_CN: MAP_CN,
  VERIFY_URL: VERIFY_URL,
  MSG: MSG,
  fmtDur: fmtDur,
  fmtClock: fmtClock,
  fmtAgo: fmtAgo,
  num: num,
  tintOf: tintOf,
  translateMapName: translateMapName,
  pickMode: pickMode,
  toEntry: toEntry,
  normalizeRotation: normalizeRotation,
  unknownModeKeys: unknownModeKeys,
  isUselessPayload: isUselessPayload,
  looksLikePredEntry: looksLikePredEntry,
  normalizePredator: normalizePredator,
  attachPredatorDeltas: attachPredatorDeltas,
  basisUsableAt: basisUsableAt,
  toEpochMs: toEpochMs,
  DELTA_MIN_AGE_MS: DELTA_MIN_AGE_MS,
  DELTA_MAX_AGE_MS: DELTA_MAX_AGE_MS,
  normalizeServers: normalizeServers,
  normalizePlayer: normalizePlayer,
  normalizeUid: normalizeUid,
  isUidLike: isUidLike,
  classifyUpstream: classifyUpstream
};
