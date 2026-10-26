/**
 * 「我的」（第 5 个 tab，2026-10-27 加的）：Evo 的绑定 —— 绑定的电脑、扫码绑定、解绑、游戏账号。
 *
 * 这一页只是个外壳：内容是分包 evo 里的 devices 组件（异步引用，见 me.json 的 componentPlaceholder），
 * 主包只剩约 120 KB 余量，Evo 的东西都放分包。导航栏和 ⚙ 设置面板和「战绩」页一模一样。
 */
var i18n = require("../../utils/i18n.js");
var theme = require("../../utils/theme.js");

/** 自定义导航栏的尺寸（和地图页、「战绩」页同一套算法） */
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

Page({
  data: {
    navTop: 20,
    navH: 44,
    navRight: 96,
    panelOpen: false,
    lang: i18n.getLang(),
    T: i18n.T(i18n.getLang()),
    theme: theme.getTheme()
  },

  onLoad: function () {
    this.setData(navMetrics());
  },

  onShow: function () {
    // 语言、主题可能在别的页面切过（全项目共用一份）
    var l = i18n.getLang();
    if (l !== this.data.lang) this.setData({ lang: l, T: i18n.T(l) });
    var th = theme.getTheme();
    if (th !== this.data.theme) this.setData({ theme: th });
    i18n.applyChrome(this.data.lang, "navMe");
    theme.applyChrome(this.data.theme);
  },

  onTogglePanel: function () {
    this.setData({ panelOpen: !this.data.panelOpen });
  },

  onTheme: function (e) {
    var t = theme.setTheme(e.currentTarget.dataset.t);
    if (t !== this.data.theme) this.setData({ theme: t });
  },

  onLang: function (e) {
    var l = i18n.setLang(e.currentTarget.dataset.l);
    if (l === this.data.lang) return;
    this.setData({ lang: l, T: i18n.T(l) });
    i18n.applyChrome(l, "navMe");
  }
});
