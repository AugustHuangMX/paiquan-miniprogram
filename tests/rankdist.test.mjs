// 本赛季段位分布（+「你在哪」）。
//
// 两个部分都要盯：
//   1. **云函数那个解析器**（cloudfunctions/apex/rankdist.js）—— 它面对的是一段
//      第三方 JSON，形状一旦变了就会静默解析出垃圾。所以这里用**真实响应结构**做夹具；
//   2. **展示层换算**（miniprogram/utils/rankdist.js）—— 最容易错的是
//      "比你高 / 比你低" 的百分比：算错方向就会给出完全相反的暗示。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
const require = createRequire(import.meta.url);
const cloud = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "rankdist.js"));
const rankdist = require(path.join(MP, "utils", "rankdist.js"));
const i18n = require(path.join(MP, "utils", "i18n.js"));

const CJK = /[\u4e00-\u9fff]/;

/* ---- 夹具：照抄上游真实响应的形状（26 个小段，稀疏数组，一格有值） ---- */
function fixture() {
  const subs = [
    ["Rookie IV", 0.917, 5261], ["Rookie III", 0.113, 646],
    ["Rookie II", 0.078, 448], ["Rookie I", 0.44, 2522],
    ["Bronze IV", 3.858, 22136], ["Bronze I", 1.754, 10061],
    ["Silver IV", 5.314, 30489], ["Silver I", 2.149, 12331],
    ["Gold IV", 6.065, 34798], ["Gold I", 3.452, 19804],
    ["Platinum IV", 5.588, 32062], ["Platinum I", 7.075, 40591],
    ["Diamond IV", 9.077, 52080], ["Diamond I", 2.493, 14303],
    ["Master", 1.827, 10480], ["Apex Predator", 0.546, 3135],
  ];
  const names = subs.map((s) => s[0]);
  const out = [{ name: "Rank", data: names }];
  subs.forEach(([name, pct, count], i) => {
    const arr = new Array(names.length).fill(0);
    arr[i] = pct;
    out.push({ name, color: "#fff", data: arr, totalCount: count });
  });
  return out;
}

describe("段位分布 · 云函数解析", () => {
  test("26 个小段归并成 8 个大段，人数和占比都对得上", () => {
    const r = cloud.parseDistrib(fixture());
    assert.ok(r, "解析失败");
    assert.deepEqual(r.tiers.map((t) => t.key),
      ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Apex Predator"]);
    const bronze = r.tiers.find((t) => t.key === "Bronze");
    assert.equal(bronze.players, 22136 + 10061);
    assert.equal(Math.round(bronze.pct * 1000) / 1000, 5.612);
    const total = r.tiers.reduce((a, t) => a + t.players, 0);
    assert.equal(r.total, total);
    assert.equal(total, 5261 + 646 + 448 + 2522 + 22136 + 10061 + 30489 + 12331 +
      34798 + 19804 + 32062 + 40591 + 52080 + 14303 + 10480 + 3135);
  });

  test("段位顺序照上游给的原样，不自己重排", () => {
    const r = cloud.parseDistrib(fixture());
    assert.equal(r.tiers[0].key, "Rookie", "最低段排在最前面");
    assert.equal(r.tiers[r.tiers.length - 1].key, "Apex Predator");
  });

  test("小段名归大段：认不出的原样保留，不猜", () => {
    assert.equal(cloud.bigTier("Rookie IV"), "Rookie");
    assert.equal(cloud.bigTier("Bronze I"), "Bronze");
    assert.equal(cloud.bigTier("Master"), "Master");
    assert.equal(cloud.bigTier("Apex Predator"), "Apex Predator");
    assert.equal(cloud.bigTier("Some New Rank"), "Some New Rank");
    assert.equal(cloud.bigTier(""), "");
    assert.equal(cloud.bigTier(null), "");
  });

  test("垃圾输入返回 null（不许解析出空分布或全 0）", () => {
    assert.equal(cloud.parseDistrib(null), null);
    assert.equal(cloud.parseDistrib({}), null);
    assert.equal(cloud.parseDistrib([]), null);
    assert.equal(cloud.parseDistrib([{ name: "Rank", data: [] }]), null);
    assert.equal(cloud.parseDistrib("nope"), null);
  });

  test("接口形状：空数组 / 缺 totalCount 也不会崩", () => {
    const r = cloud.parseDistrib([
      { name: "Rank", data: ["Gold I", "Diamond IV"] },
      { name: "Gold I", data: [12.5, 0] },
      { name: "Diamond IV", data: [0, 7.5] },
    ]);
    assert.ok(r);
    assert.equal(r.total, 0);
    assert.equal(r.tiers.length, 2);
  });

  test("抓取失败时返回 ok:false，而不是一个空分布", async () => {
    cloud._clearCache();
    const r = await cloud.handle({}, { fetchImpl: async () => ({ ok: false, status: 403, text: async () => "" }) });
    assert.equal(r.ok, false);
    assert.ok(r.message);
  });

  test("正常抓取：解析成功并带上抓取时间", async () => {
    cloud._clearCache();
    const r = await cloud.handle({}, {
      now: () => 1234567890,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(fixture()) }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.updatedAt, 1234567890);
    assert.equal(r.data.tiers.length, 8);
    cloud._clearCache();
  });
});

describe("段位分布 · 展示层", () => {
  const data = (() => {
    const r = cloud.parseDistrib(fixture());
    return { updatedAt: Date.now() - 60000, total: r.total, tiers: r.tiers };
  })();

  test("没有数据返回 null（界面整块不渲染，不留空壳）", () => {
    assert.equal(rankdist.build(null, null, "zh"), null);
    assert.equal(rankdist.build({ tiers: [] }, null, "zh"), null);
  });

  test("段位名走 i18n 那套译名（不要在这里另写一份）", () => {
    const zh = rankdist.build(data, null, "zh");
    const en = rankdist.build(data, null, "en");
    assert.equal(zh.rows.find((r) => r.key === "Diamond").main, i18n.rankName("Diamond", "zh"));
    assert.equal(en.rows.find((r) => r.key === "Diamond").main, i18n.rankName("Diamond", "en"));
    assert.equal(zh.rows[0].main, "新手");
    assert.equal(en.rows[0].main, "Rookie");
    assert.ok(!CJK.test(en.rows.map((r) => r.main).join("")), "英文模式下段位名不能是中文");
  });

  test("条形按各自最大值归一化，且宽度合法", () => {
    const v = rankdist.build(data, null, "zh");
    const maxPct = Math.max(...data.tiers.map((t) => t.pct));
    const top = v.rows.reduce((a, b) => (b.bar > a.bar ? b : a));
    assert.equal(top.bar, 100, "占比最大的那一档应当占满");
    v.rows.forEach((r) => assert.ok(r.bar >= 0 && r.bar <= 100, r.main + " 宽度越界"));
    assert.ok(data.tiers.length > 0);
    assert.ok(maxPct > 0);
  });

  test("猎杀者这种小于 0.1% 的**不能显示成 0.0%**", () => {
    const v = rankdist.build({
      updatedAt: 1, total: 1000,
      tiers: [{ key: "Apex Predator", pct: 0.04, players: 1, subs: [] }],
    }, null, "zh");
    assert.equal(v.rows[0].pctText, "<0.1%");
  });

  test("查到人之后标出他那一档，并给出高/低/同段的占比", () => {
    const v = rankdist.build(data, { rankName: "Diamond" }, "zh");
    assert.equal(v.mine.has, true);
    assert.equal(v.mine.tierLabel, "钻石");
    const mineRow = v.rows.filter((r) => r.mine);
    assert.equal(mineRow.length, 1, "只能标一档");
    assert.equal(mineRow[0].key, "Diamond");
    // 比钻石高的只有 Master + Apex Predator
    const above = data.tiers.filter((t) => ["Master", "Apex Predator"].includes(t.key))
      .reduce((a, t) => a + t.pct, 0);
    assert.ok(v.mine.aboveText.includes(above.toFixed(1) + "%"), v.mine.aboveText);
    assert.ok(v.mine.belowText.includes("%"));
    assert.ok(v.mine.sameText.includes("%"));
  });

  test("小段名也能对上大段；认不出的段位就**不标记**（不硬塞）", () => {
    assert.equal(rankdist.bigKeyOf("Diamond II"), "Diamond");
    assert.equal(rankdist.bigKeyOf("Apex Predator"), "Apex Predator");
    assert.equal(rankdist.bigKeyOf("Grandmaster"), "");
    assert.equal(rankdist.build(data, { rankName: "Grandmaster" }, "zh").mine.has, false);
    assert.equal(rankdist.build(data, null, "zh").mine.has, false);
    assert.equal(rankdist.build(data, {}, "zh").mine.has, false);
  });

  test("样本量和口径说明都在（不给分母就是耍流氓）", () => {
    const v = rankdist.build(data, null, "zh");
    assert.ok(v.sampleText.includes("样本"), v.sampleText);
    assert.ok(/口径/.test(v.caveat), "必须写明这是第三方账号库、不是官方全量");
    assert.ok(v.updatedText);
    const en = rankdist.build(data, null, "en");
    assert.ok(!CJK.test(en.sampleText), en.sampleText);
    assert.ok(!CJK.test(en.caveat), en.caveat);
    const enMine = rankdist.build(data, { rankName: "Diamond" }, "en").mine;
    ["tierLabel", "sameText", "aboveText", "belowText"].forEach((k) =>
      assert.ok(!CJK.test(enMine[k]), "英文模式的 mine." + k + " 混了中文：" + enMine[k]));
  });

  test("文案里不许出现 %%（占位符自己带了单位，模板里别再写一个）", () => {
    // 实测踩过：{p} 传进去的已经是 "0.5%"，模板后面又写了个 % → 界面上是 "0.5%%"。
    // 这种错很难靠肉眼在截图里发现，所以钉在测试里。
    for (const lang of ["zh", "en"]) {
      const v = rankdist.build(data, { rankName: "Diamond" }, lang);
      const all = [v.mine.sameText, v.mine.aboveText, v.mine.belowText,
        v.sampleText, v.caveat, v.rows.map((r) => r.pctText).join(" ")].join(" ");
      assert.ok(!/%%/.test(all), lang + " 模式出现了 %%：" + all);
    }
  });
});
