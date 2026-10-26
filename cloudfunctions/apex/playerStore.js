/**
 * 玩家排位追踪的存储层：追踪名单（tracked_players）+ 玩家快照（player_rank_snapshots）。
 *
 * 和 store.js 同一条铁律：**任何数据库错误都吞掉、降级、留日志**。
 * 追踪只是附加功能，不能让数据库故障影响地图/分数线/战绩这些主功能。
 *
 * 只注入给云函数；网页版没有数据库，自然就没有追踪。
 */

var snap = require("./snapshot");
var playerSnap = require("./playerSnapshots");

var TRACKED = "tracked_players";
var SNAPS = "player_rank_snapshots";

/** 撞主键是"这一小时已经记过"的预期情况，不算错 */
function isDuplicateKey(msg) {
  return /duplicate|E11000|already exist|已存在|主键/i.test(String(msg || ""));
}

/**
 * @param cloud require("wx-server-sdk") 的结果（已 init）
 */
function createPlayerStore(cloud) {
  var db = cloud.database();
  var _ = db.command;
  var tracked = db.collection(TRACKED);
  var snaps = db.collection(SNAPS);

  return {
    /** 该用户已追踪的人数（配额用）。查询失败按 0 处理——真失败时 add 也写不进，不会超额。 */
    countBy: async function (openid) {
      try {
        var res = await tracked.where({ addedBy: openid }).count();
        return res && typeof res.total === "number" ? res.total : 0;
      } catch (e) {
        console.warn("读追踪人数失败（按 0 处理）：" + (e && e.message ? e.message : String(e)));
        return 0;
      }
    },

    /** 加一条追踪。撞主键 / 任何错误都吞掉，返回是否真的加进去了 */
    add: async function (entry) {
      try {
        await tracked.add({ data: {
          uid: String(entry.uid),
          platform: entry.platform || "PC",
          name: entry.name || "",
          addedBy: entry.addedBy || "",
          addedAt: Math.round(Number(entry.addedAt || Date.now())),
          lastRp: null,
          lastRankName: "",
          lastAt: null,
        } });
        return true;
      } catch (e) {
        var msg = e && e.message ? e.message : String(e);
        if (!isDuplicateKey(msg)) {
          console.warn("加追踪失败：" + msg);
        }
        return false;
      }
    },

    /** 该用户追踪的全部条目（含最近一次刷到的分数） */
    listBy: async function (openid) {
      try {
        var res = await tracked.where({ addedBy: openid }).orderBy("addedAt", "desc").limit(100).get();
        return Array.isArray(res && res.data) ? res.data : [];
      } catch (e) {
        console.warn("读追踪名单失败：" + (e && e.message ? e.message : String(e)));
        return [];
      }
    },

    /** 删一条追踪（只删属于该用户的）。返回是否真的删掉了 */
    removeBy: async function (openid, uid) {
      try {
        var res = await tracked.where({ addedBy: openid, uid: String(uid) }).remove();
        return !!(res && res.stats && res.stats.removed);
      } catch (e) {
        console.warn("删追踪失败：" + (e && e.message ? e.message : String(e)));
        return false;
      }
    },

    /** 全部追踪条目（定时刷分用）。失败返回空数组 */
    all: async function () {
      try {
        var res = await tracked.limit(1000).get();
        return Array.isArray(res && res.data) ? res.data : [];
      } catch (e) {
        console.warn("读全部追踪名单失败：" + (e && e.message ? e.message : String(e)));
        return [];
      }
    },

    /** 把玩家最新分数回写到名单（列表直接展示用），失败吞掉 */
    touchTracked: async function (uid, player) {
      try {
        await tracked.where({ uid: String(uid) }).update({
          data: {
            lastRp: player && typeof player.rankScore === "number" ? player.rankScore : null,
            lastRankName: player && player.rankName ? player.rankName : "",
            lastAt: Math.round(Date.now()),
          },
        });
      } catch (e) {
        console.warn("更新追踪条目失败：" + (e && e.message ? e.message : String(e)));
      }
    },

    /** 记一条玩家快照，并顺手清 30 天前的老数据 */
    writeSnapshot: async function (uid, player, nowMs) {
      var doc = playerSnap.snapshotOf(uid, player, nowMs);
      if (!doc) return;

      try {
        await snaps.add({ data: doc });
        console.log("已记一条玩家排位快照 " + doc._id);
      } catch (e) {
        var msg = e && e.message ? e.message : String(e);
        if (!isDuplicateKey(msg)) {
          console.warn("写玩家快照失败：" + msg);
        }
      }

      try {
        await snaps.where({ at: _.lt(snap.pruneBefore(nowMs)) }).remove();
      } catch (e) { /* 清理失败下次再清 */ }
    },

    /** 取某玩家约 24 小时前的基准快照；拿不到返回 null */
    readBasis: async function (uid, nowMs) {
      try {
        var res = await snaps
          .where({ uid: String(uid) })
          .orderBy("at", "desc")
          .limit(30)
          .get();
        return playerSnap.pickBasis(res && res.data, nowMs);
      } catch (e) {
        console.warn("读玩家基准快照失败：" + (e && e.message ? e.message : String(e)));
        return null;
      }
    },
  };
}

module.exports = { createPlayerStore: createPlayerStore, TRACKED: TRACKED, SNAPS: SNAPS };
