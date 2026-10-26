/**
 * 猎杀底分快照：把「当前分数线」按小时记一条，供第二天算「较昨日同期涨了多少」。
 *
 * 为什么必须自己存：上游 /predator 只给当前值，**没有历史接口**
 * （实测 /predator/history 返回的就是当前值 —— 那个路径被忽略了）。
 *
 * 这个文件只放纯逻辑（不碰数据库），好让它能在 Node 里直接测。
 * 真正的读写由 store.js 负责，库不存在/权限不对时会被吞掉，只当"没有基准"。
 */

var core = require("./core");

// 按小时分桶：同一个小时内只写一条，一天最多 24 条，库不会涨得失控
var BUCKET_MS = 3600 * 1000;
// 只留 30 天。算涨幅只需要 24 小时前的，留更久没意义还拖慢查询
var KEEP_MS = 30 * 24 * 3600 * 1000;

/** 快照的文档 id：同一个小时内是同一个 id（靠主键冲突天然去重） */
function bucketId(ms) {
  return "h" + Math.floor(Number(ms) / BUCKET_MS);
}

/**
 * 归一化后的分组 → 要写进库的文档。
 * 只记分数：人数那些字段对算涨幅没用，不占库。
 * 一条有效分数都没有时返回 null —— 不往库里塞空快照。
 */
function snapshotOf(group, nowMs) {
  if (!group || !Array.isArray(group.plats)) return null;

  var plats = {};
  var n = 0;
  group.plats.forEach(function (p) {
    if (!p || typeof p.code !== "string") return;
    if (typeof p.rp !== "number" || !isFinite(p.rp) || p.rp <= 0) return;
    plats[p.code] = { rp: p.rp };
    n++;
  });
  if (!n) return null;

  return { _id: bucketId(nowMs), at: Math.round(Number(nowMs)), plats: plats };
}

/**
 * 从候选快照里挑「最接近 24 小时前」的那一条。
 * 窗口（20~28 小时）由 core.basisUsableAt 判定 —— 太近不叫"昨日"，
 * 太远就不是"同期"，宁可返回 null 让界面不显示，也不给一个语义含混的数字。
 */
function pickBasis(docs, nowMs) {
  if (!Array.isArray(docs)) return null;
  var target = Number(nowMs) - 24 * 3600 * 1000;
  var best = null;

  docs.forEach(function (d) {
    if (!d || typeof d.at !== "number" || !isFinite(d.at)) return;
    if (!d.plats || typeof d.plats !== "object") return;
    if (!core.basisUsableAt(d.at, nowMs)) return;
    if (!best || Math.abs(d.at - target) < Math.abs(best.at - target)) best = d;
  });

  return best ? { at: best.at, plats: best.plats } : null;
}

/** 该清掉比这个时间更早的快照 */
function pruneBefore(nowMs) {
  return Math.round(Number(nowMs) - KEEP_MS);
}

module.exports = {
  BUCKET_MS: BUCKET_MS,
  KEEP_MS: KEEP_MS,
  bucketId: bucketId,
  snapshotOf: snapshotOf,
  pickBasis: pickBasis,
  pruneBefore: pruneBefore,
};
