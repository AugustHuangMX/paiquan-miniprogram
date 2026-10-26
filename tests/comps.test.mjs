// 职业热门组合（cloudfunctions/apex/comps.js）的测试。
//
// 这一层是**抓 ALGS 赛事网页解析**（上游 API 里没有赛事数据），
// 所以最大的风险是"页面结构变了、解析出空结果"，而空结果会被当成
// "职业比赛没有热门组合" —— 假数据。因此重点验证：
// 解析准确、选赛事时的排序/回退正确、全军覆没时报错而不是返回空。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const comps = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "comps.js"));

const BASE = "https://apexlegendsstatus.com";

// 取自上游真实页面的结构
const COMP_HTML = `
<table data-column-manager="comp-legends-data">
<tr><th>Legend</th><th>Pick rate%</th></tr>
<tbody id="teamCompositionBody">
<tr><td><p class="noPMargin"><img src="/a.png" alt="Player" class="legendIcon" /><img src="/b.png" alt="Player" class="legendIcon" /><img src="/c.png" alt="Player" class="legendIcon" />&nbsp;&nbsp;&nbsp;Caustic, Sparrow, Wraith</p></td><td>45%</td><td>10.1</td><td>0%</td><td>33.3%</td><td>0%</td><td>54.8%</td><td>9</td></tr>
<tr><td><p class="noPMargin"><img src="/d.png" alt="Player" class="legendIcon" /><img src="/e.png" alt="Player" class="legendIcon" /><img src="/f.png" alt="Player" class="legendIcon" />&nbsp;&nbsp;&nbsp;Rampart, Sparrow, Wraith</p></td><td>40%</td><td>10.1</td><td>12.5%</td><td>25%</td><td>33.3%</td><td>52.9%</td><td>8</td></tr>
<tr><td>坏行没有八列</td><td>1%</td></tr>
</tbody></table>`;

const INDEX_HTML = `
<a href="/algs/Y5-Split2/ALGS-Championships/Global/Overview">x</a>
<a href="/algs/Y6-Split1/ALGS-Playoffs/Global/Overview">x</a>
<a href="/algs/Y6-Split2/ENC-Qualifiers/EMEA/Overview">x</a>
<a href="/algs/Y6-Split2/Pro-League/EMEA/Overview">x</a>
<a href="/algs/Y6-Split2/Pro-League/APAC_S/Overview">x</a>
<a href="/algs/Y6-Split2/Pro-League/Global/Overview">x</a>`;

const mkFetch = (map) => (url) => {
  const p = String(url).replace(BASE, "");
  if (!(p in map)) return Promise.reject(new Error("没有这个页面: " + p));
  return Promise.resolve({ ok: true, status: 200, text: async () => map[p] });
};

describe("comps · 赛事列表", () => {
  test("抽出去重后的赛事，并按「年份/赛季 → 赛区优先级 → 赛事级别」排序", () => {
    const list = comps.parseTournaments(INDEX_HTML);
    assert.deepEqual(list.map((t) => t.path), [
      "/algs/Y6-Split2/Pro-League/Global/Overview",       // 同年同赛季：Global 最优先
      "/algs/Y6-Split2/Pro-League/APAC_S/Overview",       // 其次亚太南部（中国战队所在赛区）
      "/algs/Y6-Split2/Pro-League/EMEA/Overview",         // 再是欧美；同赛区里级别高的在前
      "/algs/Y6-Split2/ENC-Qualifiers/EMEA/Overview",
      "/algs/Y6-Split1/ALGS-Playoffs/Global/Overview",    // 上个赛季往后排
      "/algs/Y5-Split2/ALGS-Championships/Global/Overview",
    ]);
  });

  test("赛区优先级：全球 > 亚太南部 > 亚太北部 > 欧美", () => {
    assert.ok(comps.regionRank("Global") > comps.regionRank("APAC_S"));
    assert.ok(comps.regionRank("APAC_S") > comps.regionRank("APAC_N"));
    assert.ok(comps.regionRank("APAC_N") > comps.regionRank("EMEA"));
    // 欧美的数据参考价值相同，不分高下
    assert.equal(comps.regionRank("NA"), comps.regionRank("EMEA"));
    assert.equal(comps.regionRank("EMEA"), comps.regionRank("SomewhereNew"));
  });

  test("同一路径重复出现只保留一条", () => {
    const twice = INDEX_HTML + INDEX_HTML;
    const list = comps.parseTournaments(twice);
    assert.equal(list.length, new Set(list.map((t) => t.path)).size);
  });

  test("空/异常输入不抛异常", () => {
    assert.deepEqual(comps.parseTournaments(""), []);
    assert.deepEqual(comps.parseTournaments(null), []);
  });
});

describe("comps · 组合表解析", () => {
  test("英雄译成中文、各列数值解析正确、最热的排前面", () => {
    const list = comps.parseComps(COMP_HTML);
    assert.equal(list.length, 2, "坏行要被跳过");
    assert.equal(list[0].text, "侵蚀 + 琉雀 + 恶灵");
    assert.deepEqual(list[0].legends.map((l) => l.nameEn), ["Caustic", "Sparrow", "Wraith"]);
    assert.equal(list[0].pickRate, 45);
    assert.equal(list[0].avgPlace, 10.1);
    assert.equal(list[0].winRate, 0);
    assert.equal(list[0].top5Rate, 33.3);
    assert.equal(list[0].occurrences, 9);
    // 9 场 > 8 场，所以侵蚀那条在前
    assert.equal(list[1].text, "兰伯特 + 琉雀 + 恶灵");
    assert.equal(list[1].winRate, 12.5);
  });

  test("没有组合表（页面改版）时返回空数组，不抛异常", () => {
    assert.deepEqual(comps.parseComps("<html>改版了</html>"), []);
    assert.deepEqual(comps.parseComps(""), []);
    assert.deepEqual(comps.parseComps(null), []);
  });

  test("译名表里没有的英雄保留英文，不显示空白", () => {
    const html = '<tbody id="teamCompositionBody"><tr><td><p>BrandNew, Wraith, Loba</p></td><td>5%</td><td>10</td><td>0%</td><td>0%</td><td>0%</td><td>0%</td><td>1</td></tr></tbody>';
    const list = comps.parseComps(html);
    assert.equal(list[0].text, "BrandNew + 恶灵 + 罗芭");
  });
});

describe("comps · 取数", () => {
  const baseMap = () => ({ "/algs/": INDEX_HTML, "/algs/Y6-Split2/Pro-League/Global/Overview": COMP_HTML });

  test("取到数据：带上赛事名与赛区", async () => {
    comps._clearCache();
    const r = await comps.handle({}, { fetchImpl: mkFetch(baseMap()) });
    assert.equal(r.ok, true);
    assert.equal(r.data.event.label, "Y6 Split2 · Pro-League");
    assert.equal(r.data.event.region, "全球");
    assert.equal(r.data.comps.length, 2);
    assert.equal(r.data.comps[0].text, "侵蚀 + 琉雀 + 恶灵");
  });

  test("最新赛事还没开打（没有组合表）→ 自动回退到有数据的那个", async () => {
    comps._clearCache();
    const map = {
      // 把首页里最新的那个换成「还没开打」的赛事
      "/algs/": INDEX_HTML.replace("/algs/Y6-Split2/Pro-League/Global/Overview", "/algs/Y6-Split2/ALGS-Playoffs/Global/Overview"),
      "/algs/Y6-Split2/ALGS-Playoffs/Global/Overview": "<html>还没开打</html>",
      // 次优先的赛事有数据 → 应该回退到它
      "/algs/Y6-Split2/Pro-League/EMEA/Overview": COMP_HTML,
    };
    const r = await comps.handle({}, { fetchImpl: mkFetch(map) });
    assert.equal(r.ok, true);
    assert.equal(r.data.event.path, "/algs/Y6-Split2/Pro-League/EMEA/Overview");
    assert.equal(r.data.event.region, "欧洲中东");
  });

  test("首页取不到 → 报错，不返回空（空会被当成「没有热门组合」）", async () => {
    comps._clearCache();
    const r = await comps.handle({}, { fetchImpl: () => Promise.reject(new Error("网络炸了")) });
    assert.equal(r.ok, false);
    assert.ok(r.message.length > 0);
  });

  test("所有赛事都没有组合表 → 报错，不返回空", async () => {
    comps._clearCache();
    const map = { "/algs/": INDEX_HTML };
    const r = await comps.handle({}, { fetchImpl: mkFetch(map) });
    assert.equal(r.ok, false);
  });

  test("只保留最热的前 N 个组合", async () => {
    comps._clearCache();
    let rows = "";
    for (let i = 0; i < 30; i++) {
      rows += `<tr><td><p>Wraith, Loba, Octane</p></td><td>${i}%</td><td>10</td><td>0%</td><td>0%</td><td>0%</td><td>0%</td><td>${i}</td></tr>`;
    }
    const html = '<tbody id="teamCompositionBody">' + rows + "</tbody>";
    const r = await comps.handle({}, { fetchImpl: mkFetch({ "/algs/": INDEX_HTML, "/algs/Y6-Split2/Pro-League/Global/Overview": html }) });
    assert.equal(r.data.comps.length, comps.MAX_COMPS);
    assert.equal(r.data.event.total, 30, "总数要如实报告，不能只报截断后的");
  });

  test("六小时内命中缓存，不重复打上游", async () => {
    comps._clearCache();
    let calls = 0;
    const counting = (url) => { calls++; return mkFetch(baseMap())(url); };
    const t = 1800000000000;
    await comps.handle({}, { fetchImpl: counting, now: () => t });
    const first = calls;
    const r2 = await comps.handle({}, { fetchImpl: counting, now: () => t + 60 * 1000 });
    assert.equal(calls, first, "六小时内不该再打上游");
    assert.equal(r2.cached, true);
  });
});

describe("comps · 赛区中文名", () => {
  test("常见赛区都有中文名，不认识的保留原文", () => {
    assert.equal(comps.regionCn("Global"), "全球");
    assert.equal(comps.regionCn("APAC_S"), "亚太南部");
    assert.equal(comps.regionCn("APAC_N"), "亚太北部");
    assert.equal(comps.regionCn("EMEA"), "欧洲中东");
    assert.equal(comps.regionCn("NA"), "北美");
    assert.equal(comps.regionCn("APAC-South"), "亚太南部");
    assert.equal(comps.regionCn("SomewhereNew"), "SomewhereNew");
    assert.equal(comps.regionCn(""), "");
  });
});
