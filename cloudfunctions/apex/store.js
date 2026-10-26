/**
 * 快照存储：用云开发数据库存"每小时一条"的猎杀底分。
 *
 * **只在云函数里用。** 网页版（Netlify 函数）没有数据库，所以那边不注入 store，
 * 也就没有"涨幅"这个附加信息 —— 这是可接受的降级，不是 bug。
 *
 * 一条铁律：**这里任何错误都必须被吞掉，降级成"没有数据"**。
 * 集合没建、权限不对、库超时、主键冲突 —— 都不该让用户看不到分数线。
 */

var core = require("./core");
var snap = require("./snapshot");

var COLLECTION = "predator_snapshots";
// 区间里最多取几条候选，交给 pickBasis 挑最接近 24 小时的
var CANDIDATES = 5;

/**
 * 这个错误是不是"同一小时内已经记过"（撞主键）。
 * 撞主键是预期内的正常情况，不该刷日志；其它错误必须留下来。
 * 两种写法都要认：MongoDB 的 E11000，以及云开发返回的中文提示。
 */
function isDuplicateKey(msg) {
  return /duplicate|E11000|already exist|已存在|主键/i.test(String(msg || ""));
}

/**
 * @param cloud require("wx-server-sdk") 的结果（已 init）
 */
function createStore(cloud) {
  var db = cloud.database();
  var _ = db.command;
  var col = db.collection(COLLECTION);

  return {
    /** 取约 24 小时前的基准快照；拿不到就返回 null */
    readBasis: async function (nowMs) {
      try {
        var res = await col
          .where({
            at: _.gte(nowMs - core.DELTA_MAX_AGE_MS).and(_.lte(nowMs - core.DELTA_MIN_AGE_MS)),
          })
          .orderBy("at", "desc")
          .limit(CANDIDATES)
          .get();
        return snap.pickBasis(res && res.data, nowMs);
      } catch (e) {
        // 集合不存在 / 权限问题 / 任何数据库错误 → 当作"没有基准"。
        // 但必须留下日志：不然"为什么没有涨幅"永远查不出来。
        console.warn("读猎杀底分基准失败（用户侧只会表现为没有涨幅）：" + (e && e.message ? e.message : String(e)));
        return null;
      }
    },

    /** 记一条当前快照，并顺手清掉 30 天前的老数据 */
    writeCurrent: async function (group, nowMs) {
      var doc = snap.snapshotOf(group, nowMs);
      if (!doc) return;

      try {
        // 同一个小时内重复写会撞主键，忽略即可 —— 这也是"天然去重"
        await col.add({ data: doc });
        // 成功也记一笔：这是"链路通了"的唯一直接证据，排查时全靠它
        console.log("已记一条猎杀底分快照 " + doc._id + "：" + JSON.stringify(doc.plats));
      } catch (e) {
        var msg = (e && e.message ? e.message : String(e));
        // 撞主键是预期内的（这一小时已经记过），不刷日志；
        // 其它错误必须记下来 —— 静默失败最难查，用户那边只会看到"没有涨幅"
        if (!isDuplicateKey(msg)) {
          console.warn("写猎杀底分快照失败（用户侧只会表现为没有涨幅）：" + msg);
        }
      }

      try {
        await col.where({ at: _.lt(snap.pruneBefore(nowMs)) }).remove();
      } catch (e) {
        /* 清理失败无所谓，下次再清 */
      }
    },
  };
}

module.exports = { createStore: createStore, COLLECTION: COLLECTION };
