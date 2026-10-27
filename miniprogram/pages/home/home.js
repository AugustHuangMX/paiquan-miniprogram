/**
 * 首页（2026-10-27 起第 1 个 tab，原来第 1 个 tab 是地图页）。自上而下：
 *   - Evo：没绑定时教怎么绑定；绑定了显示段位、今日、上一局（分包 evo 的 evo-home 组件）
 *   - 现在玩什么：置顶的模式（默认排位）一张深色大卡 + 其余模式的小卡，点进去是原来的地图页（「全部地图」）
 *   - 大家在玩什么：所有 Evo 玩家近 7 天的统计（分包 evo 的 evo-crowd 组件，人数不够时整块不显示）
 *   - 赛事与更多：下一场比赛、小游戏，点了切到对应的 tab
 *
 * 地图轮换的数据和地图页是同一份（云端 rotation），挑卡片、拼文字在 utils/home.js（纯函数）。
 * 语言、主题的切换在「我的」页的 ⚙ 里（首页不放 ⚙，用户 2026-10-27 定的）。
 */
var vm = require("../../utils/viewmodel.js");
var cloud = require("../../utils/cloud.js");
var ad = require("../../utils/ad.js");
var i18n = require("../../utils/i18n.js");
var theme = require("../../utils/theme.js");
var prefs = require("../../utils/prefs.js");
var home = require("../../utils/home.js");
var nextmatch = require("../../utils/nextmatch.js");

var ALL_MODES = ["pubs", "ranked", "wildcard", "mixtape"];
var STALE_MS = 45 * 1000;        // 回到前台超过这么久就立刻重取（同地图页）

/** 自定义导航栏的尺寸（和地图页同一套算法：状态栏 + 胶囊位置） */
function navMetrics() {
  var info = {};
  try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { info = {}; }
  var top = info.statusBarHeight || 20;
  var h = 44;
  var right = 96;
  try {
    var r = wx.getMenuButtonBoundingClientRect();
    if (r && r.height && r.top) {
      h = (r.top - top) * 2 + r.height;
      if (info.windowWidth && r.left) right = info.windowWidth - r.left + 8;
    }
  } catch (e) { /* 旧基础库没有这个接口，用上面的保守值 */ }
  return { navTop: top, navH: h, navRight: right };
}

/** 显示哪些模式：和「全部地图」⚙ 里的勾选是同一个偏好（空数组 = 全都要） */
function shownModes() {
  var v = prefs.get("modes", ALL_MODES);
  if (!Array.isArray(v) || !v.length) return ALL_MODES.slice();
  var out = v.filter(function (id) { return ALL_MODES.indexOf(id) >= 0; });
  return out.length ? out : ALL_MODES.slice();
}

Page({
  data: {
    navTop: 20,
    navH: 44,
    navRight: 96,
    subline: "",
    loading: true,
    err: { kind: "", style: "", title: "", message: "" },
    hero: null,
    smalls: [],
    esports: null,
    lang: i18n.getLang(),
    T: i18n.T(i18n.getLang()),
    theme: theme.getTheme(),
    adUnit: ad.adUnitFor("home")
  },

  onAdError: function (e) {
    console.warn("广告加载失败", e && e.detail);
  },

  onLoad: function () {
    this.lastFetchAt = 0;
    this.setData(navMetrics());
    this.refresh();
    this.startTicker();
  },

  onShow: function () {
    this.startTicker();
    // 语言、主题都在「我的」页切，回到首页时跟上
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    // 也可能在「全部地图」⚙ 里改了显示哪些模式、置顶哪个：每次都重拼
    this.rebuild();
    if (this.lastFetchAt && (Date.now() - this.lastFetchAt) > STALE_MS) this.refresh();
  },

  onHide: function () { this.stopTicker(); },
  onUnload: function () { this.stopTicker(); },

  onPullDownRefresh: function () {
    return this.refresh().then(function () { wx.stopPullDownRefresh(); });
  },

  /**
   * 转发：「上一局」卡片右上角的分享按钮带着标题（data-title）；
   * 其他时候（右上角菜单）标题写现在大卡上的地图，没数据时一句通用的。
   */
  onShareAppMessage: function (res) {
    var ds = res && res.from === "button" && res.target && res.target.dataset;
    if (ds && ds.title) return { title: ds.title, path: "/pages/home/home" };
    var h = this.data.hero;
    var en = this.data.lang === "en";
    return {
      title: h && h.active
        ? (en ? "Apex: " + h.map + " — " + h.cd + " left" : "Apex 现在打「" + h.map + "」，还有 " + h.cd)
        : this.data.T.homeShareTitle,
      path: "/pages/home/home"
    };
  },

  /* ---------------- 跳转 ---------------- */

  onAllMaps: function () {
    wx.navigateTo({ url: "/pages/maps/maps" });
  },

  onEsports: function () {
    wx.switchTab({ url: "/pages/matches/matches" });
  },

  onGames: function () {
    wx.switchTab({ url: "/pages/games/games" });
  },

  /* ---------------- 倒计时 ---------------- */

  startTicker: function () {
    if (this.timer) return;
    var self = this;
    this.timer = setInterval(function () { self.tick(); }, 1000);
  },
  stopTicker: function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  tick: function () {
    var lang = this.data.lang;
    var now = Date.now();
    var patch = {};
    var overdue = false;
    var put = function (prefix, f) {
      if (!f) return;
      patch[prefix + ".cd"] = f.cd;
      patch[prefix + ".urgent"] = f.urgent;
      patch[prefix + ".pct"] = f.pct;
      patch[prefix + ".soon"] = f.soon;
      if (f.overdue) overdue = true;
    };
    if (this.data.hero) put("hero", home.tickFields(this.data.hero, now, lang));
    this.data.smalls.forEach(function (c, i) { put("smalls[" + i + "]", home.tickFields(c, now, lang)); });
    if (Object.keys(patch).length) this.setData(patch);
    if (overdue && (now - this.lastFetchAt) > 30 * 1000) this.refresh();
  },

  /* ---------------- 取数 ---------------- */

  refresh: function () {
    var self = this;
    this.lastFetchAt = Date.now();
    this.setData({ loading: true });
    return cloud.callCloud({ action: "rotation" }).then(function (r) {
      if (r.ok && r.data) {
        self._raw = r.data;   // 原始数据留一份：切语言、改设置时本地重拼，不用再打网络
        self._err = null;
      } else {
        self._raw = null;
        self._err = { kind: r.kind, message: r.message };
      }
      self.rebuild();
    });
  },

  /** 按当前语言和设置把手上的数据拼成界面字段（取完数、切语言、回到前台都走这里） */
  rebuild: function () {
    var lang = this.data.lang;
    i18n.applyChrome(lang, "navHome");
    // 原生外壳（导航栏 / tabBar）的颜色 CSS 变量管不到，得用 wx 接口单独刷
    theme.applyChrome(this.data.theme);
    var patch = {
      subline: home.greeting(new Date().getHours(), lang),
      esports: home.esportsCard(nextmatch.build(lang, Date.now()), lang),
      loading: false
    };
    if (this._raw) {
      var picked = home.pickModes(vm.buildModes(this._raw.modes || [], lang), shownModes(), prefs.get("pin", "ranked"));
      patch.hero = picked.hero ? home.heroCard(picked.hero, lang) : null;
      patch.smalls = picked.smalls.map(function (m) { return home.smallCard(m, lang); });
      patch.subline += " · " + i18n.ago(this.lastFetchAt, undefined, lang);
      patch.err = { kind: "", style: "", title: "", message: "" };
    } else if (this._err) {
      patch.hero = null;
      patch.smalls = [];
      patch.err = vm.errView(this._err.kind, this._err.message, lang);
    } else {
      patch.loading = true;
    }
    this.setData(patch);
    this.tick();   // 立刻把倒计时填上，别让用户先看到 --:--
  }
});
