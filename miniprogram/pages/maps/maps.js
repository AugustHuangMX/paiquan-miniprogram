var core = require("../../utils/core.js");
var vm = require("../../utils/viewmodel.js");
var cloud = require("../../utils/cloud.js");
var ad = require("../../utils/ad.js");
var i18n = require("../../utils/i18n.js");
var theme = require("../../utils/theme.js");
var prefs = require("../../utils/prefs.js");

var ALL_MODES = ["pubs", "ranked", "wildcard", "mixtape"];

/**
 * 自定义导航栏的尺寸。
 *
 * 这一页用了 navigationStyle: custom（微信原生导航栏不接受任何自定义元素，
 * 而我们要在标题左边放 ⚙），所以高度得自己算：
 *   顶部留白 = 状态栏高度；导航条高度 = (胶囊顶部 - 状态栏) × 2 + 胶囊高度
 * 右边还要留出胶囊的宽度，否则标题会被压到胶囊下面。
 * 算不出来时退回一组保守值，绝不返回 undefined（样式里会变成 NaN）。
 */
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

var REFRESH_MS = 60 * 1000;      // 定时重取
var STALE_MS = 45 * 1000;        // 回到前台超过这么久就立刻重取

// 置顶哪个模式（匹配 / 排位）。写本地存储，重启也记得。
var pinCur = prefs.get("pin", "ranked");

// 默认展示哪些模式：**四个都显示**（用户 2026-10 改了主意 —— 匹配也放出来）。
// 想看少一点的去 ⚙ 设置里取消勾选，勾完会记住。
var DEFAULT_MODES = ["pubs", "ranked", "wildcard", "mixtape"];

/** 想展示哪些模式。空数组等同于"全都要"，避免用户把所有勾都取消后页面变空白 */
function shownModes() {
  var v = prefs.get("modes", DEFAULT_MODES);
  if (!Array.isArray(v) || !v.length) return DEFAULT_MODES.slice();
  var out = v.filter(function (id) { return ALL_MODES.indexOf(id) >= 0; });
  return out.length ? out : DEFAULT_MODES.slice();
}

Page({
  data: {
    loading: true,
    err: { kind: "", style: "", title: "", message: "" },
    modes: [],
    unknownKeys: [],
    unknownKeysText: "",
    updatedAt: "",
    // 置顶哪个模式（匹配/排位）—— 置顶的进顶部强调区，不是"只显示它"
    pin: pinCur,
    // 模式选择面板：Windows 文件夹式的勾选列表
    panelOpen: false,
    allModes: [],
    // 「匹配默认收起」那句提示：用户可以选"不再显示"，选了就永远不再出现
    hidePubsHint: prefs.get("hide_pubs_hint", false),
    // 轮换时间表：展开状态 + 分组后的行（展开时才去云函数取，不拖慢首屏）
    schedOpen: false,
    schedLoading: false,
    sched: [],
    // 当前语言 + 词表（WXML 用 {{T.x}} 取词，取词表放 data 是 WXML 的唯一办法）
    lang: i18n.getLang(),
    T: i18n.T(i18n.getLang()),
    // 当前主题（深色 / 浅色）。颜色全在 app.wxss 的变量里，这里只决定用哪一套。
    theme: theme.getTheme(),
    // 未开通流量主时为空串，广告组件不渲染（配置见 utils/ad.js）
    adUnit: ad.adUnitFor("maps")
  },

  /** 广告拉取失败不影响页面任何功能，记一下就行 */
  onAdError: function (e) {
    console.warn("广告加载失败", e && e.detail);
  },

  /**
   * 中英文切换。整页换语言 —— 不留中英混排。
   * 已经拿到过原始数据的话本地重算，不用再打一次网络。
   */
  onLang: function (e) {
    var l = i18n.setLang(e.currentTarget.dataset.l);
    if (l === this.data.lang) return;
    this.setData({ lang: l, T: i18n.T(l) });
    this.rebuild();
  },

  /** 深色 / 浅色切换。只换根节点上的主题类，颜色由 CSS 变量接管，不用重算数据。 */
  onTheme: function (e) {
    var t = theme.setTheme(e.currentTarget.dataset.t);
    if (t !== this.data.theme) this.setData({ theme: t });
  },

  /* ---------------- 生命周期 ---------------- */

  onLoad: function () {
    this.lastFetchAt = 0;
    this.setData(navMetrics());   // 自定义导航栏的尺寸（状态栏 + 胶囊位置）
    this.refresh();
    this.startTicker();
  },

  onShow: function () {
    this.startTicker();
    // 用户可能在别的页面切了语言（语言是全项目共用的）
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    // 主题同理 —— 它是**模块级**的全局状态，但页面 data 里那份是模块首次加载时抄下来的。
    // 不同步的话：在别的页面切成浅色，回到这一页又变回深色（用户反馈过）。
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    // 每次都走 rebuild：它除了换语言，还会把**原生外壳**（底部 tab、顶部标题）
    // 刷成当前语言 —— 那两处是 app.json / 页面 json 里的静态中文，不改就在英文模式下露馅。
    this.rebuild();
    if (this.lastFetchAt && (Date.now() - this.lastFetchAt) > STALE_MS) {
      this.refresh();
    }
  },

  onHide: function () { this.stopTicker(); },
  onUnload: function () { this.stopTicker(); },

  /**
   * 转发给队友时把当前排位地图写进标题 —— 一眼就看懂，比"某小程序"强。
   * 还没拿到数据时退回一句通用标题，绝不出现 undefined。
   */
  onShareAppMessage: function () {
    var lang = this.data.lang;
    var en = lang === "en";
    var ranked = null;
    // 标题跟着**用户置顶的那张卡**走（没有置顶的就取第一张有数据的）。
    // 不写死"排位" —— 否则会出现"排位现在打<匹配的地图>"这种错话。
    this.data.modes.forEach(function (m) {
      if (!m || !m.active) return;
      if (m.pinned) ranked = m;
      else if (!ranked) ranked = m;
    });
    return {
      title: ranked
        ? (en
          ? "Apex: " + ranked.map + " \u2014 " + ranked.cd + " left"
          : "Apex 现在打「" + ranked.map + "」，还有 " + ranked.cd)
        : (en ? "Apex map rotation & Predator cutoff" : "Apex 地图轮换 · 猎杀分数线查询"),
      path: "/pages/maps/maps"
    };
  },

  onPullDownRefresh: function () {
    return this.refresh().then(function () {
      wx.stopPullDownRefresh();
    });
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

  /** 「匹配默认收起」的提示：选了不再显示就永远不再出现 */
  onHidePubsHint: function () {
    prefs.set("hide_pubs_hint", true);
    this.setData({ hidePubsHint: true });
  },

  /** 展开 / 收起"展示哪些模式"的勾选列表 */
  onTogglePanel: function () {
    this.setData({ panelOpen: !this.data.panelOpen });
  },

  /** 勾 / 取消勾一个模式。至少留一个，否则页面就空了 */
  onToggleMode: function (e) {
    var id = e.currentTarget.dataset.id;
    var on = shownModes().slice();
    var i = on.indexOf(id);
    if (i >= 0) {
      if (on.length <= 1) return;   // 最后一个不许取消
      on.splice(i, 1);
    } else {
      // 按固定顺序插回去，免得顺序乱掉
      on.push(id);
      on.sort(function (a, b) { return ALL_MODES.indexOf(a) - ALL_MODES.indexOf(b); });
    }
    prefs.set("modes", on);
    this.rebuild();
  },

  /** 置顶哪个模式（匹配 / 排位）。只换顺序和强调，不隐藏任何卡片。 */
  onPick: function (e) {
    var p = e.currentTarget.dataset.p;
    if (p !== "pubs" && p !== "ranked") return;
    if (p === this.data.pin) return;
    pinCur = prefs.set("pin", p);
    this.setData({ pin: p });
    this.rebuild();
  },

  /** 点卡片本体：只有轮换那张会展开时间表（外卡等点它没反应，别误触） */
  onTapCard: function (e) {
    if (e.currentTarget.dataset.id !== "mixtape") return;
    this.onToggleSched();
  },

  /**
   * 展开 / 收起轮换时间表。**点轮换那张卡片**触发 ——
   * 默认不显示任何按钮，省掉一行高度（第一屏要塞下广告）。
   *
   * 数据分两部分：
   *   - **玩法**：3 场一循环（子弹时间→团队死斗→控制），规律经两次独立观察验证，直接外推；
   *   - **地图**：上游只给"当前 + 下一个"，所以靠云函数后台一场一场记，
   *     没记到的格子留空显示「待记录」，绝不编。
   * 展开时才请求，不拖慢首屏。
   */
  onToggleSched: function () {
    var self = this;
    if (this.data.schedOpen) { this.setData({ schedOpen: false }); return; }
    this.setData({ schedOpen: true });

    var build = function (observed) {
      self.setData({ sched: vm.buildSchedule(observed, self._mixtapeAnchor(), Date.now(), self.data.lang) });
    };
    if (this._schedObserved) { build(this._schedObserved); return; }

    this.setData({ schedLoading: true });
    return cloud.callCloud({ action: "schedule" }).then(function (r) {
      self.setData({ schedLoading: false });
      var list = (r.ok && r.data && Array.isArray(r.data.entries)) ? r.data.entries : [];
      self._schedObserved = list;      // 记下来，切语言 / 再展开都不用重取
      build(list);
    });
  },

  /** 外推要靠当前这一场的起点和玩法对齐相位 */
  _mixtapeAnchor: function () {
    var m = null;
    this.data.modes.forEach(function (x) { if (x && x.id === "mixtape" && x.active) m = x; });
    return m ? { start: m.startSec, event: m.eventRaw } : null;
  },

  tick: function () {
    if (!this.data.modes.length) return;
    var self = this;
    var lang = this.data.lang;
    var now = Date.now();
    var patch = {};
    var overdue = false;

    this.data.modes.forEach(function (m, i) {
      if (!m.active || !m.endSec) return;
      var remainMs = m.endSec * 1000 - now;
      patch["modes[" + i + "].cd"] = remainMs > 0
        ? core.fmtDur(remainMs / 1000)          // "2:09:49" 这种纯数字格式，本来就与语言无关
        : i18n.t(lang, "rotatingNow");
      patch["modes[" + i + "].urgent"] = remainMs > 0 && remainMs < 5 * 60 * 1000;
      var total = m.endSec - m.startSec;
      patch["modes[" + i + "].pct"] = total > 0
        ? Math.min(100, Math.max(0, ((now / 1000 - m.startSec) / total) * 100)).toFixed(1)
        : 0;
      if (remainMs < -8000) overdue = true;
    });

    this.setData(patch);
    if (overdue && (now - this.lastFetchAt) > 30 * 1000) this.refresh();
  },

  /* ---------------- 取数 ---------------- */

  refresh: function () {
    var self = this;
    this.lastFetchAt = Date.now();
    this.setData({ loading: true });

    return cloud.callCloud({ action: "rotation" }).then(function (r) {
      if (r.ok && r.data) {
        // 原始数据留一份：切语言时本地重算就够了，不用再打一次网络
        self._raw = r.data;
        self._err = null;
        self.applyRaw();
      } else {
        self._raw = null;
        self._err = { kind: r.kind, message: r.message };
        self.setData({
          loading: false,
          modes: [],
          err: vm.errView(r.kind, r.message, self.data.lang)
        });
      }
    });
  },

  /** 把原始数据按**当前语言**算成界面字段 —— 取完数和切语言都走这里 */
  applyRaw: function () {
    var raw = this._raw;
    if (!raw) { this.rebuild(); return; }
    var lang = this.data.lang;
    var unknown = raw.unknownKeys || [];
    var all = vm.buildModes(raw.modes || [], lang);
    // 勾选列表的标签要用**本地化后**的模式名，所以从 buildModes 的结果里取
    var labelOf = {};
    all.forEach(function (m) { if (m) labelOf[m.id] = m.label; });
    var on = shownModes();
    var allModes = ALL_MODES.map(function (id) {
      return { id: id, label: labelOf[id] || id, on: on.indexOf(id) >= 0 };
    });

    // 匹配和排位都保留，置顶的那个排到最前面（主题色描边强调）；
    // 外卡和轮换没有官方实景照，标记成紧凑卡 —— 样式里各占一半宽，自动并成一行。
    var pin = this.data.pin;
    var modes = all.filter(function (m) {
      return m && on.indexOf(m.id) >= 0;
    });
    // 模式少的时候（用户把匹配或排位取消勾选，只剩三个）外卡和轮换**恢复成完整一行** ——
    // 那时候放得下，没必要挤成半宽。只有四个模式都在、位置实在不够时才各占一半并成一行。
    // 四个模式**都是完整一行**（用户 2026-10 的决定：不并排，看着更清楚）。
    // compact 字段保留着 —— 样式和模板还在用它区分"照片大卡 / 紧凑卡"，
    // 想改回并排只需要把这里改成 !isFull 就行。
    modes = modes.map(function (m) {
      m.compact = false;
      m.pinned = (m.id === "pubs" || m.id === "ranked") && m.id === pin;
      return m;
    });
    // 置顶的排前面，其余保持 MODE_ORDER（匹配 → 排位 → 外卡 → 轮换）
    modes.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
    this.setData({
      modes: modes,
      allModes: allModes,
      // 匹配被收起时给一句提示，不然用户以为匹配没了
      pubsHidden: on.indexOf("pubs") < 0,
      unknownKeys: unknown,
      unknownKeysText: unknown.join(lang === "en" ? ", " : "、"),
      updatedAt: i18n.ago(Date.now(), undefined, lang),
      loading: false,
      err: { kind: "", style: "", title: "", message: "" }
    });
    this.tick();   // 立刻把倒计时填上，别让用户先看到 --:--
  },

  /** 切语言后用本地已有的数据重算，不重新打网络 */
  rebuild: function () {
    i18n.applyChrome(this.data.lang, "navMaps");
    // 原生外壳（导航栏 / tabBar）的颜色 CSS 变量管不到，得用 wx 接口单独刷
    theme.applyChrome(this.data.theme);
    if (this._raw) { this.applyRaw(); return; }
    if (this._err) {
      this.setData({ err: vm.errView(this._err.kind, this._err.message, this.data.lang) });
    }
  }
});
