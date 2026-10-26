/**
 * 战队专区：读 curated_roster_resolved.json（高置信名单），
 * 并行查每个选手当前排位分，按队分组返回，缓存 30 分钟。
 *
 * 只在云函数里用（网页版没有名单、也没有这个 action）。
 * 名单是 JSON 文件，赛季换人直接改文件重新部署即可，不用动逻辑。
 */

var core = require("./core");
var handler = require("./handler");

var CACHE_TTL = 30 * 60 * 1000;
var cache = { at: 0, data: null };

var INPUT_TEXT = { "KBM": "键鼠", "controller": "手柄" };

async function handle(event, deps) {
  deps = deps || {};
  var now = (deps.now || Date.now)();
  if (cache.data && now - cache.at < CACHE_TTL) {
    return { ok: true, kind: "ok", message: "", data: cache.data, cached: true };
  }

  var roster;
  try {
    roster = require("./curated_roster_resolved.json");
  } catch (e) {
    return { ok: false, kind: "http", message: "战队名单还没配置。" };
  }

  // 收集所有带 uid 的选手（没 uid 的 = 待核对，不上）
  var players = [];
  (roster.teams || []).forEach(function (t) {
    (t.players || []).forEach(function (p) {
      if (p.uid) players.push({ team: t, p: p });
    });
  });

  // 并行取当前分数（名单固定，一次全查完；比串行快一个数量级）
  var results = await Promise.all(players.map(function (x) {
    return handler.fetchUpstream("player", { uid: x.p.uid, platform: "PC" }, deps, true);
  }));
  var byUid = {};
  players.forEach(function (x, i) { byUid[x.p.uid] = results[i]; });

  var teams = [];
  (roster.teams || []).forEach(function (t) {
    var members = [];
    (t.players || []).forEach(function (p) {
      if (!p.uid) return;
      var r = byUid[p.uid];
      var np = (r && r.kind === "ok") ? core.normalizePlayer(r.data) : null;
      var rp = (np && typeof np.rankScore === "number") ? np.rankScore : null;

      // 只展示真的打了排位的账号。
      // 未定级（0 分）的那些，要么是撞名的别人（实测有 4 级、6 级的账号），
      // 要么是选手的备用号 —— 显示「0 Unranked」既没意义又让人以为坏了。
      // 过滤放在代码里而不是删名单：他们哪天打上排位了会自动出现。
      if (rp === null || rp <= 0) return;

      members.push({
        ign: p.ign,
        name: p.name || "",
        input: INPUT_TEXT[p.input] || "",
        nation: p.nation || "",
        rankName: np.rankName || "",
        rankScore: rp,
        rankScoreText: core.num(rp),
        level: np.level,
      });
    });
    if (members.length) teams.push({ id: t.id, name: t.name, players: members });
  });

  var data = { teams: teams };
  cache = { at: now, data: data };
  return { ok: true, kind: "ok", message: "", data: data, cached: false };
}

module.exports = { handle: handle, CACHE_TTL: CACHE_TTL, _clearCache: function () { cache = { at: 0, data: null }; } };
