/**
 * 赛事数据（来源：overstat.gg 的公开 JSON API）。
 *
 * 为什么用 overstat 而不是 ALGS 官方页：
 *   官方赛事页有人机校验，云函数取不到（项目里 ALGS 数据一直只能做离线快照就是这个原因）。
 *   而 overstat 的接口是纯 JSON、不需要 Key、体积很小（实测 /api/games/<id> 只有 1.6 KB）。
 *
 * 实测（2026-10）：
 *   GET /api/games/<matchId>                  -> 每局的 match_start（unix 秒）+ 地图
 *   GET /api/stats/<matchId>/player-standings -> 队伍与选手积分
 *
 * 时间一律换算成**北京时间（UTC+8）**：
 *   这个功能的用户在国内，"几点开打"必须是国内时间，不能让用户自己减 8 小时。
 *   云函数跑在 UTC，所以换算必须在服务端做，不能指望客户端。
 *
 * 拿不到就返回 null，界面据此整块不显示 —— 沿用项目铁律：宁可留空，不给假数字。
 */
var fetcher = require("./fetcher");

var BASE = "https://overstat.gg";
// 比平台 3 秒默认超时留足余量（控制台里云函数超时应设为 20 秒）
var TIMEOUT = 8000;

// 比分要"及时更新"，但也不能每开一次页面就打一次上游。
// 未开赛时赛程几乎不变，可以缓存久一点；比分短一点。
var TTL = { schedule: 5 * 60 * 1000, standings: 60 * 1000 };

var cache = Object.create(null);   // 模块级缓存，云函数实例复用期间有效

/** unix 秒 -> 北京时间的 { text, iso, ts }；无效输入返回 null */
function beijing(unixSec) {
  var n = Number(unixSec);
  if (!isFinite(n) || n <= 0) return null;
  var d = new Date((n + 8 * 3600) * 1000);      // 加 8 小时后按 UTC 读，就是北京时间
  var p = function (x) { return (x < 10 ? "0" : "") + x; };
  return {
    ts: n,
    text: d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
          " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()),
    hm: p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()),
    day: d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate())
  };
}

/**
 * 地图内部 id -> 中文名。上游给的是 mp_rr_xxx 这种引擎名，
 * 直接显示给用户没意义；认不出来就返回 null，界面显示"地图待定"。
 */
var MAPS = {
  mp_rr_canyonlands: "诸王峡谷",
  mp_rr_desertlands: "世界尽头",
  mp_rr_olympus: "奥林匹斯",
  mp_rr_tropic_island: "风暴点",
  mp_rr_party_crasher: "残月",
  mp_rr_district: "电子区"
};

function mapCn(engineName) {
  var s = String(engineName || "");
  for (var k in MAPS) {
    if (s.indexOf(k) === 0 || s.indexOf(k) >= 0) return MAPS[k];
  }
  return null;
}

function getJson(path, deps) {
  var impl = (deps && deps.fetchImpl) || fetcher.requestText;
  return Promise.resolve(impl(BASE + path, { timeoutMs: TIMEOUT })).then(function (r) {
    if (!r || !r.ok) return null;
    return Promise.resolve(r.text()).then(function (t) {
      try { return JSON.parse(t); } catch (e) { return null; }
    });
  }).catch(function () { return null; });
}

function cached(key, ttl, now, producer) {
  var hit = cache[key];
  if (hit && (now() - hit.at) < ttl) return Promise.resolve(hit.data);
  return Promise.resolve(producer()).then(function (data) {
    if (data !== null && data !== undefined) cache[key] = { at: now(), data: data };
    return data;
  });
}

/** 赛程：某一场的每一局开赛时间（北京时间）+ 地图 */
function schedule(matchId, deps, now) {
  now = now || Date.now;
  var id = String(matchId || "").trim();
  if (!/^\d{3,12}$/.test(id)) return Promise.resolve(null);
  return cached("s:" + id, TTL.schedule, now, function () {
    return getJson("/api/games/" + id, deps).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return null;
      var out = rows.map(function (r) {
        var t = beijing(r.match_start);
        return {
          game: r.game,
          at: t ? t.ts : null,
          atText: t ? t.text : "",
          hm: t ? t.hm : "",
          day: t ? t.day : "",
          mapCn: mapCn(r.map_name)
        };
      }).filter(function (x) { return x.at; });
      out.sort(function (a, b) { return a.at - b.at; });
      return out.length ? { matchId: id, games: out } : null;
    });
  });
}

/** 积分榜：队伍 + 选手积分。比赛未开始/上游没数据时，玩家数组是空的 —— 如实返回。 */
function standings(matchId, deps, now) {
  now = now || Date.now;
  var id = String(matchId || "").trim();
  if (!/^\d{3,12}$/.test(id)) return Promise.resolve(null);
  return cached("t:" + id, TTL.standings, now, function () {
    return getJson("/api/stats/" + id + "/player-standings", deps).then(function (j) {
      if (!j || !Array.isArray(j.teams)) return null;
      return {
        matchId: id,
        teams: j.teams.map(function (t) {
          return { name: t.name, teamId: t.teamId };
        })
      };
    });
  });
}

module.exports = {
  beijing: beijing,
  mapCn: mapCn,
  schedule: schedule,
  standings: standings,
  MAPS: MAPS
};
