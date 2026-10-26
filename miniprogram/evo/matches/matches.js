/**
 * 全部对局（「我的战绩」里点"查看全部"进来）：新的在前，每页 20 局，滑到底自动读下一页。
 * 可以按模式筛选、只看待确认；修正待确认的局要在电脑上的 Evo 里（小程序只看不改）。
 */
var i18n = require("../../utils/i18n.js");
var theme = require("../../utils/theme.js");
var view = require("../utils/view.js");
var evoCloud = require("../utils/cloud.js");
var state = require("../utils/state.js");

Page({
  data: {
    lang: i18n.getLang(),
    T: i18n.T(i18n.getLang()),
    theme: theme.getTheme(),
    state: "loading",       // loading / error / unbound / empty / ready
    error: "",
    mode: "",               // "" = 全部，ranked / pubs
    review: false,          // 只看待确认
    v: null,
    rows: [],
    emptyText: "",
    loadingMore: false
  },

  onLoad: function (options) {
    if (options && options.review) this.setData({ review: true });
    this.load(1);
  },

  onShow: function () {
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    i18n.applyChrome(this.data.lang, "navEvoMatches");
    theme.applyChrome(this.data.theme);
  },

  onPullDownRefresh: function () {
    this.load(1).then(function () { wx.stopPullDownRefresh(); });
  },

  onReachBottom: function () {
    this.onMore();
  },

  onMore: function () {
    if (this.data.v && this.data.v.more && !this.data.loadingMore) this.load(this.page + 1);
  },

  load: function (page) {
    var self = this;
    var T = this.data.T;
    if (page > 1) this.setData({ loadingMore: true });
    var query = { account: state.account, mode: this.data.mode || null, review: this.data.review, page: page };
    return evoCloud.callEvo("matches", query).then(function (r) {
      if (!r.ok) {
        self.setData({ loadingMore: false });
        if (self._pages) wx.showToast({ title: view.errText(r.code, T), icon: "none" });
        else self.setData({ state: "error", error: view.errText(r.code, T) });
        return;
      }
      self.page = page;
      self._pages = page === 1 ? [r.data] : self._pages.concat(r.data);
      self.rebuild();
    });
  },

  /** 换语言时用手上的几页重拼 */
  rebuild: function () {
    if (!this._pages) return;
    var T = this.data.T;
    var last = this._pages[this._pages.length - 1];
    var v = view.matchesView(last, T);
    var rows = [];
    this._pages.forEach(function (d) { rows = rows.concat(view.matchesView(d, T).rows); });
    var st = "ready";
    if (!last.bound) st = "unbound";
    else if (!rows.length) st = "empty";
    this.setData({
      v: v,
      rows: rows,
      state: st,
      error: "",
      loadingMore: false,
      emptyText: view.emptyText(this.data.mode, this.data.review, T)
    });
  },

  onMode: function (e) {
    var mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode: mode });
    this.load(1);
  },

  onReview: function () {
    this.setData({ review: !this.data.review });
    this.load(1);
  },

  onAccount: function (e) {
    var picker = this.data.v && this.data.v.picker;
    if (!picker) return;
    state.account = picker.keys[Number(e.detail.value)];
    state.dirty = true;   // 回到「我的战绩」时按新账号重读
    this.load(1);
  },

  onMatch: function (e) {
    wx.navigateTo({ url: "/evo/match/match?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  onBind: function () {
    wx.switchTab({ url: "/pages/me/me" });
  }
});
