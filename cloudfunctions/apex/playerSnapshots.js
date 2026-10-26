/**
 * 玩家排位快照：把某个玩家的「当前排位分」按小时记一条，供第二天算「较昨日涨跌」。
 *
 * 和猎杀底分快照（snapshot.js）同一套思路，但维度不同：
 * - 猎杀底分：一条快照含四个平台（plats）
 * - 玩家排位：一条快照只含一个玩家（uid + rp + 段位）
 *
 * 纯逻辑、不碰数据库，方便直接测。真正的读写由 store.js 负责。
 */

var snap = require("./snapshot");
var core = require("./core");

/**
 * 玩家快照的文档 id：按 (小时, uid) 去重。
 * 同一个 uid 同一个小时重复写会撞主键 —— 那就是"这一小时已经记过"，天然去重。
 */
function bucketIdFor(uid, ms) {
  return snap.bucketId(ms) + "_" + String(uid);
}

/**
 * normalizePlayer 的输出 → 要写进库的文档。
 * 分数无效（null / 非数字 / 负数）时返回 null —— 不往库里塞空快照。
 * 0 分是「未定级」这个真实状态，照记。
 */
function snapshotOf(uid, p, nowMs) {
  var rp = p && p.rankScore;
  if (typeof rp !== "number" || !isFinite(rp) || rp < 0) return null;

  return {
    _id: bucketIdFor(uid, nowMs),
    uid: String(uid),
    at: Math.round(Number(nowMs)),
    rp: rp,
    rankName: p.rankName || "",
    rankDiv: typeof p.rankDiv === "number" ? p.rankDiv : 0,
    level: typeof p.level === "number" ? p.level : null,
  };
}

/**
 * 从候选快照里挑「最接近 24 小时前」的那一条。
 * 窗口（20~28 小时）沿用 core.basisUsableAt —— 太近不算"昨日"，
 * 太远就不是"同期"，宁可返回 null 让界面不显示，也不给一个语义含混的数字。
 */
function pickBasis(docs, nowMs) {
  if (!Array.isArray(docs)) return null;
  var target = Number(nowMs) - 24 * 3600 * 1000;
  var best = null;

  docs.forEach(function (d) {
    if (!d || typeof d.at !== "number" || !isFinite(d.at)) return;
    if (typeof d.rp !== "number" || !isFinite(d.rp)) return;
    if (!core.basisUsableAt(d.at, nowMs)) return;
    if (!best || Math.abs(d.at - target) < Math.abs(best.at - target)) best = d;
  });

  return best ? { at: best.at, rp: best.rp } : null;
}

module.exports = {
  bucketIdFor: bucketIdFor,
  snapshotOf: snapshotOf,
  pickBasis: pickBasis,
};
