/**
 * 轮换记录器。
 *
 * **为什么要记**：上游的 `/maprotation` 只给「当前这一场 + 下一场」，
 * 想做出"接下来两天几点打哪张图"的表，**只能自己一场一场记下来**。
 * （玩法那部分不用记 —— 它是 3 场一循环，可以直接外推，见 viewmodel.buildSchedule。）
 *
 * **记的时机**：复用云函数**已有的定时触发器**（它本来就在跑猎杀线快照），
 * 顺手把轮换也记一条。轮换 15 分钟一场、定时器 5 分钟跑一次 → 每场 3 次冗余，不会漏。
 *
 * **存法**：文档 `_id` 直接用 `模式_开始时间`，天然幂等 ——
 * 同一场被记多次只会覆盖同一条，不会长出一堆重复。
 *
 * 集合要自己在云开发控制台建（权限用默认的"仅创建者可读写"即可，
 * 只有云函数会碰它）：`rotation_log`
 */
var COLLECTION = "rotation_log";
var KEEP_SEC = 3 * 24 * 60 * 60;   // 留 3 天，够做"接下来两天"

function createLog(cloud) {
  var db = cloud.database();
  var _ = db.command;
  var col = db.collection(COLLECTION);

  return {
    /**
     * 记一批场次（重复记同一条只会覆盖）。
     * @param {Array} entries [{mode,map,event,start,end}]，start/end 是**秒**
     * @param {number} nowSec
     * @returns {Promise<number>} 实际写入条数
     */
    record: async function (entries, nowSec) {
      if (!Array.isArray(entries)) return 0;
      var n = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.mode || !isFinite(Number(e.start))) continue;
        try {
          await col.doc(e.mode + "_" + Math.floor(Number(e.start))).set({
            data: {
              mode: e.mode,
              map: e.map || "",
              event: e.event || "",
              start: Math.floor(Number(e.start)),
              end: Math.floor(Number(e.end) || 0),
              at: nowSec
            }
          });
          n++;
        } catch (err) {
          // 单条失败不影响其它（比如刚好撞上并发写同一场）
        }
      }
      return n;
    },

    /**
     * 读 [fromSec, toSec] 区间内记到的场次，按开始时间升序。
     * 两天的轮换（15 分钟一场）= 192 条，加上其它三个模式也远不到 1000。
     */
    readRange: async function (fromSec, toSec) {
      var res = await col
        .where({ start: _.gte(fromSec).and(_.lte(toSec)) })
        .orderBy("start", "asc")
        .limit(1000)
        .get();
      return (res && res.data) || [];
    },

    /** 清掉过期的，别让集合无限长。失败不影响主流程。 */
    prune: async function (nowSec) {
      try {
        await col.where({ end: _.lt(nowSec - KEEP_SEC) }).remove();
      } catch (e) { /* 忽略 */ }
    }
  };
}

module.exports = { createLog: createLog, COLLECTION: COLLECTION, KEEP_SEC: KEEP_SEC };
