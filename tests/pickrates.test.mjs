// 英雄选取率（cloudfunctions/apex/pickrates.js）的测试。
//
// 这一层是**抓网页解析**（上游 API 没这个数据），所以最大的风险是
// "页面结构变了、解析出空结果"，而空结果会被当成"这个英雄没人玩" —— 假数据。
// 因此重点验证：解析准确、结构不认识时跳过、全军覆没时报错而不是返回空。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pr = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "pickrates.js"));

// 取自上游真实页面的结构（Pathfinder 涨、Mad Maggie 落）
const FIXTURE = `
<div class="legends-banner">
<div class="legends-banner__item" style="cursor: pointer;" onclick="window.location='https://apexlegendsstatus.com/game-stats/legends-pick-rates/Pathfinder';">
  <picture><img class="legends-banner__image" alt="Pathfinder" src="/x.png" /></picture>
  <div class="legends-banner__content">
    <br />Pathfinder<br /><span style="font-size: 36px;">12.1%</span><br /><span style="font-size: 16px;"><i> <span style="font-size: 12px;"><span style="color: green";>▲</span>5.97%</span> </i></span><br /><span style="font-size: 12px; font-weight: 500;">Avg level <span style="font-weight: 600; color: #52DFFF;">615</span></span>
  </div>
</div>
<div class="legends-banner__item" style="cursor: pointer;" onclick="window.location='https://apexlegendsstatus.com/game-stats/legends-pick-rates/Mad Maggie';">
  <picture><img class="legends-banner__image" alt="Mad Maggie" src="/y.png" /></picture>
  <div class="legends-banner__content">
    <br />Mad Maggie<br /><span style="font-size: 36px;">7.5%</span><br /><span style="font-size: 16px;"><i> <span style="font-size: 12px;"><span style="color: red";>▼</span>1.43%</span> </i></span><br /><span style="font-size: 12px; font-weight: 500;">Avg level <span style="font-weight: 600; color: #52DFFF;">595</span></span>
  </div>
</div>
</div>`;

const fakeFetch = (html) => (() => ({ ok: true, status: 200, text: async () => html }));

describe("pickrates · 解析", () => {
  test("名字、选取率、涨跌、平均等级都解析出来", () => {
    const list = pr.parseLegends(FIXTURE);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { name: "探路者", nameEn: "Pathfinder", pickRate: 12.1, up: true, change: 5.97, avgLevel: 615 });
    assert.deepEqual(list[1], { name: "疯玛吉", nameEn: "Mad Maggie", pickRate: 7.5, up: false, change: 1.43, avgLevel: 595 });
  });

  test("结构变了的块直接跳过（宁可少几条，也不要错的）", () => {
    const broken = '<div class="legends-banner__item">没有名字也没有百分比</div>';
    assert.deepEqual(pr.parseLegends(broken), []);
  });

  test("空输入不抛异常", () => {
    assert.deepEqual(pr.parseLegends(""), []);
    assert.deepEqual(pr.parseLegends(null), []);
  });
});

describe("pickrates · 中文名", () => {
  // 上游页面上真实出现的 28 个英雄。少一个就说明漏译了。
  const ALL = [
    "Pathfinder", "Loba", "Octane", "Mad Maggie", "Wraith", "Axle", "Fuse", "Bangalore",
    "Lifeline", "Conduit", "Sparrow", "Vantage", "Alter", "Valkyrie", "Seer", "Ash",
    "Revenant", "Gibraltar", "Caustic", "Mirage", "Bloodhound", "Wattson", "Catalyst",
    "Horizon", "Rampart", "Newcastle", "Crypto", "Ballistic",
  ];

  test("28 个英雄全部有中文名", () => {
    const missing = ALL.filter((en) => !pr.translateLegend(en));
    assert.deepEqual(missing, [], "这些英雄还没译名：" + missing.join(", "));
  });

  test("名字不重复（两个英雄不能撞同一个中文名）", () => {
    const cn = ALL.map((en) => pr.translateLegend(en));
    assert.equal(new Set(cn).size, cn.length, "有重复的中文名");
  });

  test("两个新英雄用官方名，不用网上流传的自译", () => {
    assert.equal(pr.translateLegend("Sparrow"), "琉雀", "EA 官方帮助页用的是「琉雀」");
    assert.equal(pr.translateLegend("Axle"), "艾克赛尔");
    assert.notEqual(pr.translateLegend("Axle"), "轴锋", "「轴锋」是博主自译，不是官方名");
  });

  test("用国内玩家实际在用的叫法，不是 EA 营销页那套", () => {
    assert.equal(pr.translateLegend("Octane"), "动力小子");
    assert.equal(pr.translateLegend("Crypto"), "密客");
    assert.equal(pr.translateLegend("Caustic"), "侵蚀");
    assert.equal(pr.translateLegend("Wattson"), "沃特森");
    assert.equal(pr.translateLegend("Rampart"), "兰伯特");
    assert.equal(pr.translateLegend("Vantage"), "万蒂奇");
  });

  test("表里没有的英雄原样显示英文，绝不显示空白", () => {
    assert.equal(pr.translateLegend("BrandNewLegend"), "");
    const list = pr.parseLegends('<div class="legends-banner__item"><img alt="BrandNewLegend" /><span style="font-size: 36px;">1.2%</span></div>');
    assert.equal(list[0].name, "BrandNewLegend");
    assert.equal(list[0].nameEn, "BrandNewLegend");
  });

  test("大小写不敏感", () => {
    assert.equal(pr.translateLegend("wraith"), "恶灵");
    assert.equal(pr.translateLegend("MAD MAGGIE"), "疯玛吉");
  });
});

describe("pickrates · 取数", () => {
  test("四个段位都抓到 → 返回四个 tab", async () => {
    pr._clearCache();
    const r = await pr.handle({}, { fetchImpl: fakeFetch(FIXTURE) });
    assert.equal(r.ok, true);
    assert.equal(r.data.tiers.length, 4);
    assert.deepEqual(r.data.tiers.map((t) => t.key), ["all", "platinum", "diamond", "master"]);
    assert.equal(r.data.tiers[0].label, "全段位");
    assert.equal(r.data.tiers[0].legends[0].name, "探路者");
  });

  test("某一个段位失败 → 其它段位照常返回", async () => {
    pr._clearCache();
    let n = 0;
    const flaky = () => { n++; return n === 2 ? Promise.reject(new Error("网络炸了")) : Promise.resolve({ text: async () => FIXTURE }); };
    const r = await pr.handle({}, { fetchImpl: flaky });
    assert.equal(r.ok, true);
    assert.equal(r.data.tiers.length, 3, "挂掉一个还剩三个");
  });

  test("全部失败 → 报错，绝不返回空列表（空列表会被当成「没人玩」）", async () => {
    pr._clearCache();
    const r = await pr.handle({}, { fetchImpl: () => Promise.reject(new Error("全挂了")) });
    assert.equal(r.ok, false);
    assert.ok(r.message.length > 0);
  });

  test("页面结构变了（解析出 0 条）也算失败", async () => {
    pr._clearCache();
    const r = await pr.handle({}, { fetchImpl: fakeFetch("<html>改版了</html>") });
    assert.equal(r.ok, false);
  });

  test("一小时内命中缓存，不重复打上游", async () => {
    pr._clearCache();
    let calls = 0;
    const counting = () => { calls++; return { text: async () => FIXTURE }; };
    const t = 1800000000000;
    await pr.handle({}, { fetchImpl: counting, now: () => t });
    const first = calls;
    const r2 = await pr.handle({}, { fetchImpl: counting, now: () => t + 60 * 1000 });
    assert.equal(calls, first, "一小时内不该再打上游");
    assert.equal(r2.cached, true);
  });
});
