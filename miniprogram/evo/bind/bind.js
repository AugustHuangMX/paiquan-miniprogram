/**
 * 绑定确认：扫电脑上 Evo 的码以后打开这一页。
 * - 用微信扫一扫扫小程序码（码池 evo_qrpool 生成的）：微信直接打开这一页，绑定码在 scene 里
 * - 在小程序里点"扫码绑定"（evo/utils/cloud.js 的 scanToBind）：绑定码在 c 里
 * 绑定要用户点一下"绑定"才算（不扫到就绑），免得扫错码绑到别人的电脑。
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
    code: "",
    state: "confirm",   // confirm / binding / done / failed / nocode
    error: ""
  },

  onLoad: function (options) {
    var o = options || {};
    var code = view.bindCodeFrom(o.c || o.scene || "");
    this.setData({ code: code, state: code ? "confirm" : "nocode" });
  },

  onShow: function () {
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    i18n.applyChrome(this.data.lang, "navEvoBind");
    theme.applyChrome(this.data.theme);
  },

  onBind: function () {
    var self = this;
    if (this.data.state === "binding") return;   // 正在绑定：别连点两次
    this.setData({ state: "binding", error: "" });
    evoCloud.callEvo("bind", { code: this.data.code }).then(function (r) {
      if (!r.ok) {
        self.setData({ state: "failed", error: view.errText(r.code, self.data.T) });
        return;
      }
      state.dirty = true;
      state.account = null;
      self.setData({ state: "done" });
    });
  },

  onRescan: function () {
    evoCloud.scanToBind(this.data.T);
  },

  /** 去看战绩：「战绩」页收到 dirty 会重读，并切到「我的战绩」 */
  onGoStats: function () {
    wx.switchTab({ url: "/pages/predator/predator" });
  },

  onCancel: function () {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/me/me" });
  }
});
