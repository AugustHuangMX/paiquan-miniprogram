// 广告位配置。
//
// 为什么要有这一层：<ad-custom> 组件的 unit-id 填错/为空会报错或渲染成空白，
// 而流量主要"累计独立访客 ≥ 500"才能开通 —— 在那之前根本没有合法 ID 可填。
// 所以做一层开关：没配合法 ID 就不渲染广告组件，页面上什么都不出现；
// 开通之后把 ID 填进配置即可，不用改页面代码。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
const AD_PATH = path.join(MP, "utils", "ad.js");
if (!existsSync(AD_PATH)) throw new Error("缺少 " + AD_PATH + " —— 先写实现再跑");

const require = createRequire(import.meta.url);

function freshAd() {
  delete require.cache[require.resolve(AD_PATH)];
  return require(AD_PATH);
}

describe("广告位配置", () => {
  test("已配置的 ID 必须合法；没配的页面允许为空（不渲染广告）", () => {
    const ad = freshAd();
    for (const page of ["maps", "predator", "matches", "ringguessr"]) {
      const raw = String(ad.AD_UNITS[page] == null ? "" : ad.AD_UNITS[page]).trim();
      if (!raw) continue;   // 没配 = 页面上什么都不出现，这是允许的状态
      assert.match(raw, /^adunit-[0-9a-z]+$/i, page + " 的广告位 ID 格式不对：" + raw);
      assert.equal(ad.adUnitFor(page), raw, page + " 的合法 ID 应当原样返回");
    }
  });

  test("配了合法 ID 才返回；只配了一个页面时别的页面不受影响", () => {
    const ad = freshAd();
    // 先把每页清空，避免依赖 ad.js 里当前实际配了什么
    ad.AD_UNITS.maps = "";
    ad.AD_UNITS.predator = "";
    ad.AD_UNITS.matches = "";
    ad.AD_UNITS.maps = "adunit-1a2b3c4d5e6f7788";
    assert.equal(ad.adUnitFor("maps"), "adunit-1a2b3c4d5e6f7788");
    assert.equal(ad.adUnitFor("predator"), "", "只配了 maps，别的页面不该跟着有");
  });

  test("格式不对一律当没配（填了占位符会让组件报错/留白）", () => {
    const ad = freshAd();
    for (const bad of ["", "  ", "REPLACE_ME", "adunit-", "12345", "ad-unit-xyz", null, undefined]) {
      ad.AD_UNITS.maps = bad;
      assert.equal(ad.adUnitFor("maps"), "", "不该接受 " + JSON.stringify(bad));
    }
  });

  test("前后空格会自动去掉（从后台复制过来常带空格）", () => {
    const ad = freshAd();
    ad.AD_UNITS.maps = "  adunit-1a2b3c4d5e6f7788  ";
    assert.equal(ad.adUnitFor("maps"), "adunit-1a2b3c4d5e6f7788");
  });

  test("不认识的页面名一律返回空，不去猜", () => {
    const ad = freshAd();
    ad.AD_UNITS.maps = "adunit-1a2b3c4d5e6f7788";
    assert.equal(ad.adUnitFor("nonsense"), "");
    assert.equal(ad.adUnitFor(""), "");
    assert.equal(ad.adUnitFor(undefined), "");
  });

  test("每个页面各自的广告位互不影响", () => {
    const ad = freshAd();
    ad.AD_UNITS.maps = "adunit-aaaaaaaaaaaaaaaa";
    ad.AD_UNITS.predator = "adunit-bbbbbbbbbbbbbbbb";
    ad.AD_UNITS.matches = "adunit-cccccccccccccccc";
    assert.equal(ad.adUnitFor("maps"), "adunit-aaaaaaaaaaaaaaaa");
    assert.equal(ad.adUnitFor("predator"), "adunit-bbbbbbbbbbbbbbbb");
    // 比赛页的 WXML 里有 adbox 且调 adUnitFor("matches") —— 键名写错的话
    // 那个广告位会永远拿到空串（2026-10-16 就是这样漏了一个多月的）
    assert.equal(ad.adUnitFor("matches"), "adunit-cccccccccccccccc");
  });
});
