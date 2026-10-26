/**
 * 把"数据"变成"界面字段"的纯逻辑。
 *
 * 单独拆出来是因为页面的 index.js 里会调用 Page({...})，
 * 在 Node 里没法直接 require —— 拆开才能对这段逻辑写单元测试。
 */
var core = require("./core.js");
var i18n = require("./i18n.js");

// 失败类型的展示方式。每种都要说清"该干什么"，别丢一句报错完事。
// 标题必须互不相同，否则用户分不清到底是 Key 的问题还是网络的问题。
var ERR_VIEW = {
  nokey:      { style: "err",  title: "还没配置数据源 Key" },
  badkey:     { style: "err",  title: "数据源 Key 无效" },
  unverified: { style: "err",  title: "数据源 Key 未激活" },
  internal:   { style: "err",  title: "云函数内部错误" },
  network:    { style: "warn", title: "连不上服务器" },
  timeout:    { style: "warn", title: "响应超时" },
  ratelimit:  { style: "warn", title: "请求太频繁" },
  empty:      { style: "warn", title: "这次没取到数据" },
  http:       { style: "warn", title: "数据源返回了错误" },
  notfound:   { style: "warn", title: "查无此人" }
};

// kind → i18n 词条 key（英文模式下用；中文模式继续走上面的 ERR_VIEW，
// 因为中文的 message 来自云函数，比这里写死的更具体）
var ERR_KEY = {
  nokey: "errConfig", badkey: "errKey", unverified: "errKeyInactive",
  internal: "errInternal", network: "errNetwork", timeout: "errTimeout",
  ratelimit: "errRate", empty: "errEmpty", http: "errUpstream",
  notfound: "errPlayerNotFound"
};

var NEXT_LIMIT = 3;

/**
 * 云函数返回的失败 → 界面字段。
 *
 * 英文模式下**不能用云函数那条中文 message**（否则页面就中英混排了），
 * 所以英文走 i18n 里按 kind 写的说明；中文模式保持原样（云函数的 message 更具体）。
 */
function errView(kind, message, lang) {
  var k = kind || "http";
  var s = ERR_VIEW[k] || { style: "warn", title: "获取失败" };
  if (i18n.normalizeLang(lang) === "en") {
    var body = k === "notfound" ? i18n.t(lang, "errPlayerNotFoundBody") : i18n.t(lang, "errRetry");
    return { kind: k, style: s.style, title: i18n.t("en", ERR_KEY[k] || "errGeneric"), message: body };
  }
  return { kind: k, style: s.style, title: s.title, message: message || "" };
}

/**
 * 地图卡片在界面上的展示顺序（产品指定）：**匹配 → 排位 → 外卡 → 轮换**。
 *
 * 注意：core.js 里 MODES 的顺序是"数据顺序"，**不要动** ——
 * 那份 core.js 与网页版是逐字节共享的（apex-web/tests/sync.test.mjs 会校验），
 * 改它会连带改网页版。展示顺序只在这一层重排。
 */
var MODE_ORDER = ["pubs", "ranked", "wildcard", "mixtape"];

/**
 * 大逃杀地图 → 本地配图。
 *
 * 图放在 `assets/maps/` 里**随包发布**，不走网络 ——
 * 走网络要给图片域名备案（`downloadFile` 合法域名），随包就没这个事。
 *
 * **按英文名做键**：英文名是上游稳定字段，中文译名以后可能改，
 * 用它做键才不会"改个译名配图就没了"。
 *
 * **只有六张大逃杀地图有图**：轮换模式（Mixtape）用的是骷髅镇、碎片这类**小区域图**，
 * 没有对应的官方渲染图，所以那里留空 → 界面退回配色占位块（绝不显示碎图）。
 */
var MAP_IMAGE = {
  "Kings Canyon": "/assets/maps/kings-canyon.jpg",
  "World's Edge": "/assets/maps/worlds-edge.jpg",
  "Olympus": "/assets/maps/olympus.jpg",
  "Storm Point": "/assets/maps/storm-point.jpg",
  "Broken Moon": "/assets/maps/broken-moon.jpg",
  "E-District": "/assets/maps/e-district.jpg",
  // 轮换（Mixtape）用的小区域实景照 —— **用户自己在游戏里截的图**，不是第三方站点的素材。
  "Estates": "/assets/maps/mixtape-estates.jpg",
  "Caustic Treatment": "/assets/maps/mixtape-caustic-treatment.jpg",
  "Hammond Labs": "/assets/maps/mixtape-hammond-labs.jpg",
  "ZEUS Station": "/assets/maps/mixtape-zeus-station.jpg",
  "Zeus Station": "/assets/maps/mixtape-zeus-station.jpg",
  "Barometer": "/assets/maps/mixtape-barometer.jpg",
  "Wattson's Treatment": "/assets/maps/mixtape-wattsons-treatment.jpg",
  "Production Yard": "/assets/maps/mixtape-production-yard.jpg",
  "Fragment": "/assets/maps/mixtape-fragment.jpg",
  "Thunderdome": "/assets/maps/mixtape-thunderdome.jpg",
  "Skulltown": "/assets/maps/mixtape-skulltown.jpg"
};

/** @returns {string} 本地图片路径；这张图没有配图时返回空串 */
function mapImageOf(mapEn) {
  if (mapEn == null) return "";
  return MAP_IMAGE[String(mapEn).trim()] || "";
}

/**
 * 模式名 / 角标的中英对照。
 *
 * core.js 里的 `def.label` 是中文，而且那份 core 是三方逐字节共享的，
 * 不能按语言去改它 —— 所以这里再放一张按 id 索引的表。
 *
 * **角标也要跟语言走**：否则中文模式下页面会出现「匹配模式地图 + BR Pubs」这种中英混排，
 * 正是要避免的。
 */
var MODE_TEXT = {
  ranked:   { zh: "排位赛地图",   en: "Ranked",        tagZh: "大逃杀排位", tagEn: "BR Ranked" },
  pubs:     { zh: "匹配模式地图", en: "Battle Royale", tagZh: "大逃杀匹配", tagEn: "BR Pubs" },
  mixtape:  { zh: "轮换模式地图", en: "Mixtape",       tagZh: "轮换混战",   tagEn: "Mixtape" },
  wildcard: { zh: "外卡模式地图", en: "Wildcard",      tagZh: "外卡",       tagEn: "Wildcard" }
};

function modeLabel(id, fallback, lang) {
  var m = MODE_TEXT[id];
  if (!m) return fallback || "";
  return i18n.normalizeLang(lang) === "en" ? m.en : m.zh;
}

function modeTag(id, fallback, lang) {
  var m = MODE_TEXT[id];
  if (!m) return fallback || "";
  return i18n.normalizeLang(lang) === "en" ? m.tagEn : m.tagZh;
}

/* ============================================================
   地图轮换
   ============================================================ */

/**
 * 轮换模式（Mixtape）的**具体玩法**。
 *
 * 上游给的是英文（"Control" / "Gun Run" / "TDM"），而轮换那张卡片上没有地图照片，
 * 只写"轮换模式地图"用户根本不知道这一轮在玩什么 —— 所以要显示"控制""团队死斗"。
 *
 * 只写核对过的译名，认不出的**原样显示英文**（猜错的名字比露出英文更糟，
 * 这是项目里反复用到的口径）。
 */
var EVENT_KEY = {
  control: "evtControl",
  "team deathmatch": "evtTdm",
  tdm: "evtTdm",
  "gun run": "evtGunRun"
};

// 上游有时只在 code 里带玩法（如 freedm_tdm_estates），eventName 是空的 —— 从里面认
var EVENT_CODE_HINT = [
  [/tdm/i, "evtTdm"],
  [/control/i, "evtControl"],
  [/gunrun|gun_run/i, "evtGunRun"]
];

function eventTextOf(name, code, lang) {
  var raw = name == null ? "" : String(name).trim();
  var key = raw ? EVENT_KEY[raw.toLowerCase()] : null;
  if (!key) {
    var c = code == null ? "" : String(code);
    for (var i = 0; i < EVENT_CODE_HINT.length; i++) {
      if (EVENT_CODE_HINT[i][0].test(c)) { key = EVENT_CODE_HINT[i][1]; break; }
    }
  }
  // 认得出就用译名；认不出但上游给了名字就显示原名；两样都没有就空着（整块不渲染）
  return key ? i18n.t(lang, key) : raw;
}

/** 归一化后的四个模式 → 卡片视图模型 */
function buildModes(normalized, lang) {  if (!normalized || !normalized.length) return [];
  // 地图名要**跟着语言走**：中文模式用译名（查不到退回英文），英文模式用上游原文。
  // 以前这里无条件用译名，于是英文模式下满页地图名还是中文。
  var en = i18n.normalizeLang(lang) === "en";
  return normalized.map(function (m) {
    // 云函数理论上总会给带 def 的对象，但万一以后改了返回结构，
    // 这里必须跳过坏元素而不是让整个页面崩成白屏。
    if (!m || !m.def) return null;
    var cur = m.current;
    var base = {
      id: m.def.id,
      label: modeLabel(m.def.id, m.def.label, lang),
      tag: modeTag(m.def.id, m.def.tag, lang),
      tint: core.tintOf(cur ? cur.map : ""),
      // 轮换模式要显示"具体在玩什么玩法"（控制 / 团队死斗…），其他模式通常没有
      eventText: eventTextOf(cur ? cur.eventName : "", cur ? cur.code : "", lang),
      // 外推时间表要按**上游原名**对齐循环相位，所以原样也留一份
      eventRaw: cur ? (cur.eventName || "") : "",
      // 本地地图图；没有配图的模式（轮换）是空串，WXML 据此走占位块
      image: mapImageOf(cur ? cur.map : "")
    };
    if (!cur) {
      // 模式当前没开启：接口连这个键都不返回，官网对应区块也是空的。
      // 所以这是"未开启"，不是"取数失败"。
      return Object.assign(base, { active: false, nexts: [] });
    }
    var nexts = (m.nexts || []).slice(0, NEXT_LIMIT).map(function (n, i) {
      return {
        idx: i,
        // 显示名跟着语言走，查不到译名就退回英文（绝不空白）
        map: en ? n.map : (n.mapCn || n.map),
        mapEn: n.map,
        eventName: n.eventName,
        eventText: eventTextOf(n.eventName, n.code, lang),
        span: core.fmtClock(n.start) + "–" + core.fmtClock(n.end)
      };
    });
    return Object.assign(base, {
      active: true,
      map: en ? cur.map : (cur.mapCn || cur.map),
      // 英文原文也留着：配色按它算（换语言不该让颜色变来变去），
      // 查不到译名时也靠它兜底。
      mapEn: cur.map,
      eventName: cur.eventName,
      startSec: cur.start,
      endSec: cur.end,
      span: core.fmtClock(cur.start) + " – " + core.fmtClock(cur.end),
      nexts: nexts,
      cd: "--:--",   // 占位，onLoad 后由 tick() 每秒填
      pct: 0,
      urgent: false
    });
  }).filter(Boolean).sort(function (a, b) {
    // 展示顺序：匹配 → 排位 → 外卡 → 轮换（同 MODE_ORDER）。
    // 认不出来的 id 排在最后，不会把已知模式挤乱。
    var ia = MODE_ORDER.indexOf(a.id);
    var ib = MODE_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** 涨幅文字："+1,240" / "−8,685" / "±0"；没有对比基准时返回空串 */
function deltaTextOf(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  if (v === 0) return "±0";
  return (v > 0 ? "+" : "−") + core.num(Math.abs(v));
}

/** "较 10-08 18:00" / "vs 10-08 18:00" —— 必须写清对比的是哪一条，否则"涨了多少"没有参照 */
function basisTextOf(at, lang) {
  if (typeof at !== "number" || !isFinite(at)) return "";
  var d = new Date(at);
  var mm = d.getMonth() + 1, dd = d.getDate();
  var stamp = (mm < 10 ? "0" + mm : mm) + "-" + (dd < 10 ? "0" + dd : dd) +
    " " + core.fmtClock(Math.floor(at / 1000));
  return (i18n.normalizeLang(lang) === "en" ? "vs " : "较 ") + stamp;
}

/** 归一化后的猎杀分组 → 平台卡片视图模型 */
function buildPredator(group, nowMs, lang) {
  if (!group || !group.plats) return [];
  var t = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();

  return group.plats.map(function (p) {
    // delta 是"较昨日同期"的差值。null 表示没有可用的对比基准 ——
    // 那时整行不渲染，绝不显示成 +0（那会让人以为底分真的一分没动）。
    var delta = (typeof p.delta === "number" && isFinite(p.delta)) ? p.delta : null;
    return {
      code: p.code,
      label: p.label,
      rpText: core.num(p.rp),
      // 人数缺失就不显示这一行，别显示成 0 人或 -1
      predCountText: p.predCount != null ? core.num(p.predCount) : "",
      mastersText: p.masters != null ? core.num(p.masters) : "",
      deltaText: deltaTextOf(delta),
      // 底分跌了对想冲猎杀的人是好事：暖色表示"又涨了"，绿色表示"降了"
      deltaUp: delta != null ? delta >= 0 : false,
      deltaBasisText: delta != null ? basisTextOf(p.deltaBasisAt, lang) : "",
      // 上游这份数据什么时候刷新的（不是我们什么时候取的）—— 取不到就不显示
      updatedAtText: p.updatedAt ? i18n.ago(p.updatedAt, t, lang) : ""
    };
  });
}

/**
 * 赛季代号翻译成人话。
 * 上游给的是 "br_ranked_s30_s2" 这种内部代号，直接甩给用户没人看得懂；
 * 认不出来就干脆不显示，不硬凑一句可能错的。
 */
function fmtSeason(s, lang) {
  if (!s) return "";
  var m = /_s(\d+)_s(\d+)$/.exec(String(s));
  if (!m) return "";
  return i18n.normalizeLang(lang) === "en"
    ? (" \u00b7 Season " + m[1] + " Split " + m[2])
    : (" \u00b7 第" + m[1] + "赛季 第" + m[2] + "阶段");
}

/** 归一化后的玩家 → 结果面板视图模型 */
function buildPlayer(p, lang) {
  var en = i18n.normalizeLang(lang) === "en";
  var rankText = p.rankName
    ? (i18n.rankName(p.rankName, lang) + (p.rankDiv ? " " + p.rankDiv : ""))
    : i18n.t(lang, "notRanked");
  return {
    name: p.name,
    uid: p.uid || "",
    uidText: p.uid ? "UID " + p.uid : "",
    platform: p.platform,
    levelText: p.level != null ? (en ? " \u00b7 level " + p.level : " · 等级 " + p.level) : "",
    seasonText: fmtSeason(p.season, lang),
    rankText: rankText,
    rankScore: p.rankScore,
    rankScoreText: p.rankScore != null ? core.num(p.rankScore) : "—",
    // 接口只在玩家进入猎杀后才给榜内名次；-1 已在归一化层转成 null
    ladderText: p.ladderPos != null ? "#" + core.num(p.ladderPos) : i18n.t(lang, "notInLadder"),
    // 界面里"未进榜"要换灰、还要多显示一句说明 —— 用布尔判断，
    // **不要去比对 ladderText 字符串**：那样一换语言就失效了。
    noLadder: p.ladderPos == null
  };
}

/**
 * ⚠️ 这里原来有一个 buildStats（战绩页的视图模型：等级/段位/在线状态/封禁/生涯条目）。
 * 2026-10-16 用户要求把第 4 个 tab 从「战绩」换成「猜圈」小游戏，那一页整页删除了，
 * 于是这个 builder 也失去了唯一的调用方 —— 跟着删掉，不留没有消费者的死代码。
 * 它和 buildPlayer 有重叠（等级/段位/名次），排位专区页用的是后者。
 * 要恢复：从备份目录里把 stats 页四件套 + 这个函数一起拿回来。
 */

/* ============================================================
   距猎杀线差额
   ============================================================ */

/**
 * 算「这个玩家离猎杀线还差多少分」。
 *
 * 返回 null 表示「这块不该显示」，页面据此整块隐藏。这里刻意**不用 0 兜底**：
 * 分数线取不到的时候如果退化成 0，界面上就会出现「还差 0 分」——
 * 那是在骗人，比什么都不显示糟糕得多。同理，已经在榜内的人绝不能走减法，
 * 否则会显示负数差额。
 *
 * @param {{rankScore?:number, ladderPos?:number, platform?:string}} p 归一化后的玩家
 * @param {{plats:Array}} group 归一化后的猎杀分组
 * @param {string} [platformCode] 平台代码；不传就用玩家自己的平台
 */
function predatorGap(p, group, platformCode) {
  if (!p || typeof p !== "object") return null;

  var code = platformCode || p.platform || "";
  var plats = (group && group.plats) || [];
  var line = null;
  for (var i = 0; i < plats.length; i++) {
    // 必须精确匹配平台：拿别的平台的分数线去比，数字就是错的
    if (plats[i] && plats[i].code === code) { line = plats[i].rp; break; }
  }
  // 分数线只有在是个正数时才算数，0 / 负数 / null 一律当成"没拿到"
  if (typeof line !== "number" || !isFinite(line) || line <= 0) line = null;

  var score = (typeof p.rankScore === "number" && isFinite(p.rankScore)) ? p.rankScore : null;

  // 已在榜内的人：名次比分数线有意义，而且名次要摆在前头 ——
  // 它不依赖分数线，分数线缺了也照样能显示名次
  if (typeof p.ladderPos === "number" && p.ladderPos > 0) {
    return { kind: "pred", rank: p.ladderPos, score: score, line: line, need: null };
  }

  if (score == null || line == null) return null;
  // 0 分 = 这阶段压根没打排位。实测证据：上游在 rank 里直接给出
  // ALStopPercent: "No game this split"，而且真实打过排位的最低分是 1
  // （Rookie IV = 1 分，实测 shroud 的 PS4 档就是这个值）。
  // 这种情形照减法算会说"还差 20,770 分"，读起来像 bug：没起步就谈不上差距。
  if (!(score > 0)) return null;
  // 刚好压线也算"已达到"：差额必须是正数，没有"还差 0 分"这种说法
  if (score >= line) return { kind: "above", rank: null, score: score, line: line, need: null };
  return { kind: "below", rank: null, score: score, line: line, need: line - score };
}

/** predatorGap 的计算结果 → 界面文字。取不到数据时返回 null，整块不渲染。 */
function buildPredGap(p, group, platformCode, lang) {
  var en = i18n.normalizeLang(lang) === "en";
  var g = predatorGap(p, group, platformCode);
  if (!g) return null;

  var unit = en ? "" : " 分";
  var lineText = g.line != null ? core.num(g.line) + unit : "";
  var scoreText = g.score != null ? core.num(g.score) + unit : "";

  if (g.kind === "pred") {
    return {
      kind: "pred",
      title: i18n.t(lang, "gapAlready"),
      value: "#" + core.num(g.rank),
      unit: "",
      // 没有分数线就什么都不说，不编一个出来
      note: lineText ? i18n.t(lang, "gapLinePre") + lineText : ""
    };
  }
  if (g.kind === "above") {
    return {
      kind: "above",
      title: i18n.t(lang, "gapReached"),
      value: "—",
      unit: "",
      note: [
        lineText ? (en ? "cutoff " + lineText : "猎杀线 " + lineText) : "",
        scoreText ? i18n.t(lang, "gapCurrentPre") + scoreText : ""
      ].filter(Boolean).join(" · ")
    };
  }
  return {
    kind: "below",
    title: en ? "RP to the Predator cutoff" : "距猎杀线还差",
    value: core.num(g.need),
    unit: en ? "RP" : "分",
    note: (en ? "cutoff " + lineText : "猎杀线 " + lineText) + " · " + i18n.t(lang, "gapCurrentPre") + scoreText
  };
}

/* ============================================================
   轮换时间表（外推 + 已观察）
   ============================================================ */

/**
 * 轮换的**玩法是 3 场一循环**：子弹时间 → 团队死斗 → 控制 → 子弹时间…
 * 每场 15 分钟，所以 45 分钟一轮回。
 *
 * 这条规律有**两次独立观察**对上，不是猜的：
 *   1. 用户在 ALS 上看到的连续 5 场：子弹时间→团队死斗→控制→子弹时间→团队死斗
 *   2. 上游 API 的 current + next：Fragment(子弹时间) → Estates(团队死斗，code 里带 tdm)
 * 所以玩法可以往后外推。
 *
 * **地图不能外推**：那是另一个更长的循环，而上游只给"当前 + 下一个"。
 * 没观察到的场次地图列留空，由云函数的后台记录逐步补上 —— 宁可留空也不编。
 */
var EVENT_CYCLE = ["evtGunRun", "evtTdm", "evtControl"];
var SLOT_MS = 15 * 60 * 1000;                 // 一场 15 分钟
// 往后看 24 小时。再多就是 192 格，排成两列也要拉很久 —— 看当前和接下来一天够用了。
var HORIZON_MS = 24 * 60 * 60 * 1000;
var MAX_ROWS = 96;                            // 24 小时 / 15 分钟 = 96 格

/** 把一个时间戳按本地时区格式化成 HH:MM */
function clockOf(ms) {
  var d = new Date(ms);
  return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" +
         (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
}

/** 按本地时区判断两个时间戳是不是同一天 */
function sameLocalDay(a, b) {
  var x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * 接下来两天的轮换表。
 *
 * @param {Array}  observed 云函数攒下来的场次 [{mode,map,event,start,end}]
 * @param {Object} anchor   当前这一场 {start, event}（用来对齐 3 场循环的相位）
 * @param {number} nowMs
 * @param {string} lang
 */
function buildSchedule(observed, anchor, nowMs, lang) {
  var t = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();

  // 已观察到的场次按"开始时间"索引，用来填地图列
  var seen = {};
  (observed || []).forEach(function (e) {
    if (!e || e.mode !== "mixtape") return;
    var s = Number(e.start);
    if (isFinite(s) && e.map) seen[String(s)] = e.map;
  });

  // 对齐 3 场循环的相位：anchor.event 是第几项，就从那里开始数。
  // 注意 anchor.start 和云函数记的 start 都是**秒**，这里统一换成毫秒再算。
  var aStartSec = anchor && isFinite(Number(anchor.start)) ? Number(anchor.start) : null;
  var aStart = aStartSec != null ? aStartSec * 1000 : null;
  var aRaw = anchor && anchor.event ? String(anchor.event).toLowerCase() : "";
  var phase = 0;
  if (aRaw) {
    var idx = EVENT_KEY[aRaw] ? EVENT_CYCLE.indexOf(EVENT_KEY[aRaw]) : -1;
    if (idx >= 0) phase = idx;
  }

  // 从当前这一场的**下一场**开始排
  var cursor;
  if (aStart != null) {
    cursor = aStart + SLOT_MS;
  } else {
    cursor = Math.ceil(t / SLOT_MS) * SLOT_MS;   // 没锚点就从下一个整刻开始
  }

  var groups = [];
  var cur = null;
  for (var i = 0; i < MAX_ROWS; i++) {
    var startMs = cursor + i * SLOT_MS;
    if (startMs - t > HORIZON_MS) break;

    // 相对锚点过了几场 → 决定玩法（锚点是 phase，往后 +1）
    var step = (aStart != null) ? (i + 1) : i;
    var evtKey = EVENT_CYCLE[(phase + step) % EVENT_CYCLE.length];

    var label = i18n.t(lang, "schedToday");
    if (!sameLocalDay(startMs, t)) {
      label = sameLocalDay(startMs, t + 24 * 60 * 60 * 1000) ? i18n.t(lang, "schedTomorrow") : i18n.t(lang, "schedDayAfter");
    }
    if (!cur || cur.label !== label) {
      cur = { label: label, rows: [] };
      groups.push(cur);
    }
    cur.rows.push({
      idx: i,
      time: clockOf(startMs),
      endTime: clockOf(startMs + SLOT_MS),
      // 没观察到的场次地图列留空 —— WXML 显示成占位符，绝不编一个名字
      map: seen[String(Math.floor(startMs / 1000))] || "",
      event: i18n.t(lang, evtKey)
    });
  }
  return groups;
}

/* ============================================================
   分享链接
   ============================================================ */

// Apex 的游戏内 ID 很短，32 位已经很宽松。这个上限同时用于解析入参和生成链接，
// 图的是那条不变式：**我们自己生成的链接，自己一定能解析回来**。
var MAX_PLAYER_LEN = 32;
var BAD_NAME = /[\u0000-\u001f\u007f]/;

/** 外链带来的参数是否是个能拿去查询的玩家名；不行就返回空串 */
function cleanPlayerName(v) {
  if (v == null) return "";
  var s = String(v).trim();
  if (!s || s.length > MAX_PLAYER_LEN || BAD_NAME.test(s)) return "";
  return s;
}

function platformIndexOf(code) {
  var c = String(code == null ? "" : code).toUpperCase();
  for (var i = 0; i < core.PLATFORMS.length; i++) {
    if (core.PLATFORMS[i].code === c) return i;
  }
  return -1;
}

/**
 * 页面 onLoad(options) 的入参 → {player, platformIndex, uid}。
 * 拿不到能用的玩家名**也没有 uid** 就返回 null，页面据此什么都不做 ——
 * 宁可停在默认状态，也不要拿空名字或超长名字去打接口。
 */
function parseShare(options) {
  if (!options || typeof options !== "object") return null;
  var name = cleanPlayerName(options.player);
  // uid 是唯一能区分同名账号的东西：分享链接带上它，好友点开就不会查到同名的另一个人
  var uid = core.normalizeUid(options.uid);
  if (!name && !uid) return null;
  var idx = platformIndexOf(options.platform);
  // 平台认不出来就退回第一个：好友至少还能看到这个人，总比什么都不做强
  return { player: name, platformIndex: idx < 0 ? 0 : idx, uid: uid };
}

/**
 * 生成分享路径。玩家名和 uid 都没有时只给页面路径，绝不产出打不开的链接。
 * 两个都给上最好：uid 保证查到的就是同一个人，名字让输入框有东西显示。
 */
function sharePath(page, player, platformCode, uid) {
  var base = "/pages/" + page + "/" + page;
  var name = cleanPlayerName(player);
  var u = core.normalizeUid(uid);
  if (!name && !u) return base;

  var q = "";
  if (name) q += "?player=" + encodeURIComponent(name);
  if (u) q += (q ? "&" : "?") + "uid=" + encodeURIComponent(u);
  if (platformCode) q += "&platform=" + encodeURIComponent(String(platformCode));
  return base + q;
}

/* ============================================================
   服务器状态
   ============================================================ */

var SERVER_STATUS_TEXT = { UP: "正常", SLOW: "缓慢", DOWN: "故障", UNKNOWN: "未知" };
// 未知状态用 warn 而不是 ok：不确定的东西不该显示成绿色
var SERVER_TONE = { UP: "ok", SLOW: "warn", DOWN: "bad", UNKNOWN: "warn" };

function serverStatusText(s) { return SERVER_STATUS_TEXT[s] || "未知"; }

/** 归一化后的服务器状态 → 界面字段。没有可用数据时返回 null，整块不渲染。 */
function buildServers(n, nowMs) {
  if (!n || !n.groups || !n.groups.length) return null;
  var t = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();

  var groups = n.groups.map(function (g) {
    return {
      key: g.key,
      label: g.label,
      status: g.status,
      statusText: serverStatusText(g.status),
      tone: SERVER_TONE[g.status] || "warn",
      // 主机网络那两行只有一个区域、名字和行名重复，就不要再写一遍
      detailText: (g.trouble || [])
        .filter(function (t) { return t.label !== g.label; })
        .map(function (t) { return t.label + " " + serverStatusText(t.status); })
        .join("、"),
      msText: g.ms != null ? "最慢 " + core.num(g.ms) + " ms" : ""
    };
  });

  // 异常项置顶，正常的沉底。同档保持上游顺序（手工分桶，不依赖 sort 的稳定性）。
  var ordered = [];
  ["bad", "warn", "ok"].forEach(function (tone) {
    groups.forEach(function (g) { if (g.tone === tone) ordered.push(g); });
  });

  var problem = n.summary ? n.summary.problem : 0;
  var down = n.summary ? n.summary.down : 0;

  return {
    tone: problem === 0 ? "ok" : (down > 0 ? "bad" : "warn"),
    summaryText: problem === 0 ? "全部正常" : "有 " + problem + " 项异常",
    unknownText: (n.unknown || []).join("、"),
    // 这份状态是上游什么时候探的（不是我们什么时候取的）—— 取不到就不显示
    queriedAtText: n.queriedAt ? core.fmtAgo(n.queriedAt, t) : "",
    groups: ordered
  };
}

/* ============================================================
   战队专区
   ============================================================ */

/** 战队专区数据 → 界面字段。数据由云函数 teams.js 取好并格式化，
    这里做兜底（字段缺失不崩），同时是「WXML 用了哪些字段」的登记处。 */
function buildTeams(teams) {
  if (!Array.isArray(teams)) return [];
  return teams.map(function (t) {
    return {
      id: t.id || "",
      name: t.name || "",
      players: Array.isArray(t.players) ? t.players.map(function (p) {
        return {
          uid: p.uid || "",
          ign: p.ign || "",
          name: p.name || "",
          input: p.input || "",
          nation: p.nation || "",
          rankName: p.rankName || "",
          rankScore: p.rankScore,
          rankScoreText: p.rankScoreText || "—",
          level: p.level
        };
      }) : []
    };
  });
}

/* ============================================================
   ⚠️ 这里原来有「英雄选取率」和「职业热门组合（ALGS）」两组 builder
   （buildPickLegends / buildPickTabs / buildComps）。
   2026-10-16 用户要求把战绩页那两块删掉：排位专区里已经有这两样内容
   （职业选手的英雄选取 / 三人英雄组合，见 utils/prostats.js）。
   builder 是页面的纯函数，页面没了就跟着删 —— 留着没有消费者，只会让
   "全站还有这个功能"这个印象留在代码里。
   服务端的解析模块（cloudfunctions/apex/pickrates.js、comps.js）暂时保留，
   要恢复的话：把 builder 从 git 历史/备份里拿回来，再加回 stats 页那两块即可。
   ============================================================ */

/**
 * 赛季（战斗通行证）倒计时。
 *
 * 结束时间来自云端配置（site_config 集合里 _id="season" 那条的 endTs）。
 * 游戏里显示的是"21d6h"这种**天 + 小时** ✗ —— 所以这里也报到小时，不报分钟秒：
 * 再细就是编的，反而让人以为数据精确到分钟。
 *
 * 用 floor 而不是 ceil：既然同时给出小时，剩下的零头就由小时来表达
 * （21 天 6 小时就是 days=21, hours=6，不能说成 22 天）。
 *
 * 已结束时返回 ended=true，由界面决定说什么 —— 绝不显示负数。
 * 云端没配置（endTs 为 0）时 show=false，整行不显示。
 */
function buildSeasonCountdown(endTs, nowMs, lang) {
  var end = Number(endTs) || 0;
  if (!end) return { show: false, ended: false, days: 0, hours: 0 };
  var leftMs = end * 1000 - (nowMs || Date.now());
  if (leftMs <= 0) return { show: true, ended: true, days: 0, hours: 0 };
  return {
    show: true,
    ended: false,
    days: Math.floor(leftMs / 86400000),
    hours: Math.floor((leftMs % 86400000) / 3600000)
  };
}

module.exports = {
  ERR_VIEW: ERR_VIEW,
  NEXT_LIMIT: NEXT_LIMIT,
  MAX_PLAYER_LEN: MAX_PLAYER_LEN,
  fmtSeason: fmtSeason,
  errView: errView,
  buildModes: buildModes,
  buildPredator: buildPredator,
  buildPlayer: buildPlayer,
  predatorGap: predatorGap,
  buildPredGap: buildPredGap,
  parseShare: parseShare,
  sharePath: sharePath,
  buildServers: buildServers,
  buildTeams: buildTeams,
  buildSchedule: buildSchedule,
  buildSeasonCountdown: buildSeasonCountdown
};
