/**
 * 段位分布 + 「你在哪」。
 *
 * 数据来自云函数 `rankdist` 动作（它去抓上游那个 JSON 接口，见
 * cloudfunctions/apex/rankdist.js）。这里只做**展示层的换算**，不联网。
 *
 * 这个板块回答的是排位玩家最想知道、而别处都没有的那个问题：
 *   **"我这个段位，在全体排位玩家里算什么水平？"**
 * 现有数据能给的是"猎杀线多少分""你多少分"，但没有人告诉你分母有多大 ——
 * 有了分布才知道：钻石之上只剩百分之几、大师有多稀有。
 *
 * 三个刻意的取舍：
 *   1. 段位名走 i18n.rankName（**不在这里另写一份译名表**）——
 *      玩家卡片上显示的段位名和这里的必须一致，两份表迟早会打架；
 *   2. 「你在这里」**不能只靠颜色**表示（无障碍要求），所以额外给一个文字标记；
 *   3. 百分比、人数、口径说明都写出来。只给一根条形图等于没给信息。
 */

var i18n = require("./i18n.js");
var core = require("./core.js");

/* 玩家卡片上的段位名 → 分布里的大段 key。
   上游给的是大段名（"Diamond" / "Apex Predator"），正常情况直接命中；
   给的是小段名（"Diamond II"）时按前缀归并；认不出就返回空串（不标记"你在这里"）。 */
var BIG = ["Apex Predator", "Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"];

function bigKeyOf(name) {
  var s = String(name == null ? "" : name).trim();
  if (!s) return "";
  for (var i = 0; i < BIG.length; i++) {
    if (s.toLowerCase() === BIG[i].toLowerCase()) return BIG[i];
  }
  for (var j = 0; j < BIG.length; j++) {
    if (s.toLowerCase().indexOf(BIG[j].toLowerCase()) === 0) return BIG[j];
  }
  return "";
}

function fmtPct(v) {
  var n = isFinite(v) ? v : 0;
  // 小于 0.1% 的段位（猎杀者常见）不要显示成 "0.0%" —— 那看着像没有
  if (n > 0 && n < 0.1) return "<0.1%";
  return n.toFixed(1) + "%";
}

function bar(pct, max) {
  if (!max || !isFinite(max) || max <= 0) return 0;
  var w = Math.round((pct / max) * 100);
  return w < 3 && pct > 0 ? 3 : w;
}

/**
 * @param {object|null} data  云函数 rankdist 的 data：{updatedAt,total,tiers:[{key,pct,players,subs}]}
 * @param {object|null} player 已查到的玩家（core.normalizePlayer 之后的对象，用它的 rankName）
 * @param {string} lang "zh" | "en"
 * @returns {object|null} 取不到数据返回 null（界面整块不渲染，不留空壳）
 */
function build(data, player, lang) {
  if (!data || !Array.isArray(data.tiers) || !data.tiers.length) return null;

  var maxPct = 0;
  data.tiers.forEach(function (t) { if (t.pct > maxPct) maxPct = t.pct; });

  var mineKey = bigKeyOf(player && player.rankName);

  var rows = data.tiers.map(function (t) {
    return {
      key: t.key,
      // 段位名走 i18n.rankName：中文模式给中文、英文模式给英文原文。
      // 这里**不另给副名** —— 八行紧凑表里塞两行名字会挤掉条形图的宽度。
      main: i18n.rankName(t.key, lang),
      pctText: fmtPct(t.pct),
      playersText: core.num(t.players),
      bar: bar(t.pct, maxPct),
      mine: !!mineKey && t.key === mineKey
    };
  });

  var mine = { has: false, tierLabel: "", sameText: "", aboveText: "", belowText: "" };
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].mine) continue;
    var above = 0, below = 0;
    for (var a = i + 1; a < data.tiers.length; a++) above += data.tiers[a].pct;
    for (var b = 0; b < i; b++) below += data.tiers[b].pct;
    mine = {
      has: true,
      tierLabel: rows[i].main,
      sameText: i18n.t(lang, "rankSame")
        .replace("{p}", fmtPct(data.tiers[i].pct))
        .replace("{n}", core.num(data.tiers[i].players)),
      aboveText: i18n.t(lang, "rankAbove").replace("{p}", fmtPct(Math.round(above * 1000) / 1000)),
      belowText: i18n.t(lang, "rankBelow").replace("{p}", fmtPct(Math.round(below * 1000) / 1000))
    };
    break;
  }

  return {
    updatedText: data.updatedAt ? i18n.ago(data.updatedAt, Date.now(), lang) : "",
    sampleText: i18n.t(lang, "rankSample").replace("{n}", core.num(data.total || 0)),
    caveat: i18n.t(lang, "rankCaveat"),
    rows: rows,
    hasRows: rows.length > 0,
    mine: mine
  };
}

module.exports = { build: build, bigKeyOf: bigKeyOf };
