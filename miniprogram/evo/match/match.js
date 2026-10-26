/**
 * 单局详情：这一局的所有数字和两名队友。待确认的局写明原因，修正要在电脑上的 Evo 里。
 */
var i18n = require("../../utils/i18n.js");
var theme = require("../../utils/theme.js");
var view = require("../utils/view.js");
var evoCloud = require("../utils/cloud.js");

Page({
  data: {
    lang: i18n.getLang(),
    T: i18n.T(i18n.getLang()),
    theme: theme.getTheme(),
    state: "loading",   // loading / error / ready
    error: "",
    m: null
  },

  onLoad: function (options) {
    this.id = decodeURIComponent((options && options.id) || "");
    this.load();
  },

  onShow: function () {
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    i18n.applyChrome(this.data.lang, "navEvoMatch");
    theme.applyChrome(this.data.theme);
    this.rebuild();
  },

  onPullDownRefresh: function () {
    this.load().then(function () { wx.stopPullDownRefresh(); });
  },

  load: function () {
    var self = this;
    return evoCloud.callEvo("match", { id: this.id }).then(function (r) {
      if (!r.ok) {
        self.setData({ state: "error", error: view.errText(r.code, self.data.T) });
        return;
      }
      self._raw = r.data;
      self.rebuild();
    });
  },

  rebuild: function () {
    if (!this._raw) return;
    this.setData({ m: view.detail(this._raw, this.data.T), state: "ready", error: "" });
  },

  onRetry: function () {
    this.setData({ state: "loading" });
    this.load();
  }
});
