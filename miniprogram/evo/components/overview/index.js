/**
 * 「我的战绩」组件（放在「战绩」页顶部切换的第一栏）。
 *
 * 在分包 evo 里、由主包页面异步引用（app.json 的 subpackages + 页面 json 的 componentPlaceholder）：
 * 主包只剩约 120 KB 余量，Evo 的页面、徽章图都放分包，用到时才下载。
 *
 * 读完会发 status 事件（{ bound }）：「战绩」页据此决定默认显示哪一栏（绑定了 Evo 的人先看自己的战绩）。
 */
var i18n = require("../../../utils/i18n.js");
var view = require("../../utils/view.js");
var evoCloud = require("../../utils/cloud.js");
var state = require("../../utils/state.js");

var STALE_MS = 60 * 1000;   // 切回这一页时，超过 1 分钟就重新读
var EMBLEM_RPX = 160;       // 段位徽章多大（rpx），和 index.wxss 的 .evo-emblem 一样

Component({
  options: { styleIsolation: "apply-shared" },   // 用 app.wxss 的 .panel / .sec-title / .msg / .langsw

  properties: {
    lang: { type: String, value: "zh" },
    theme: { type: String, value: "dark" }
  },

  data: {
    T: i18n.T("zh"),
    state: "loading",
    error: "",
    range: "30",
    v: null
  },

  observers: {
    lang: function (lang) {
      this.setData({ T: i18n.T(lang) });
      this.rebuild();
    },
    theme: function () {
      this.drawChart();
    }
  },

  lifetimes: {
    attached: function () {
      this.load();
    }
  },

  pageLifetimes: {
    show: function () {
      if (this.loadedAt && (state.dirty || Date.now() - this.loadedAt > STALE_MS)) this.load();
    }
  },

  methods: {
    load: function () {
      var self = this;
      if (!this._raw) this.setData({ state: "loading" });
      state.dirty = false;
      return evoCloud.callEvo("overview", { account: state.account, range: this.data.range }).then(function (r) {
        if (!r.ok) {
          // 已经有数据时保留旧的，只提示一下
          if (self._raw) wx.showToast({ title: view.errText(r.code, self.data.T), icon: "none" });
          else self.setData({ state: "error", error: view.errText(r.code, self.data.T) });
          self.triggerEvent("status", { bound: false, failed: true });
          return;
        }
        self.loadedAt = Date.now();
        self._raw = r.data;
        state.account = r.data.account;
        self.rebuild();
        self.triggerEvent("status", { bound: r.data.bound });
      });
    },

    /** 换语言时用手上的数据重拼，不再打网络 */
    rebuild: function () {
      if (!this._raw) return;
      var v = view.overview(this._raw, this.data.T, EMBLEM_RPX);
      var self = this;
      this.setData({ v: v, state: v.state, error: "" }, function () { self.drawChart(); });
    },

    onRange: function (e) {
      var range = e.currentTarget.dataset.range;
      if (range === this.data.range) return;
      this.setData({ range: range });
      this.load();
    },

    onAccount: function (e) {
      var picker = this.data.v && this.data.v.picker;
      if (!picker) return;
      state.account = picker.keys[Number(e.detail.value)];
      this.load();
    },

    onMatch: function (e) {
      wx.navigateTo({ url: "/evo/match/match?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
    },

    onAll: function () {
      wx.navigateTo({ url: "/evo/matches/matches" });
    },

    onReview: function () {
      wx.navigateTo({ url: "/evo/matches/matches?review=1" });
    },

    onScan: function () {
      evoCloud.scanToBind(this.data.T);
    },

    /** RP 走势：红线 + 淡红底，段位分界线画成虚线，最后一局一个圆点（同 Evo 窗口） */
    drawChart: function (attempt) {
      var tries = attempt || 0;
      var chart = this.data.v && this.data.v.chart;
      if (!chart) return;
      var self = this;
      this.createSelectorQuery().select("#evo-chart").fields({ node: true, size: true }).exec(function (res) {
        var item = res && res[0];
        if (!item || !item.node || !item.width) {   // 画布刚放进页面、还没准备好：等一下再画
          if (tries < 10) setTimeout(function () { self.drawChart(tries + 1); }, 100);
          return;
        }
        var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        var dpr = info.pixelRatio || 2;
        var canvas = item.node;
        var ctx = canvas.getContext("2d");
        var w = item.width;
        var h = item.height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        var c = view.chartColors(self.data.theme);
        var right = w - 6;   // 给最后的圆点留位置
        var n = chart.points.length;
        var xy = chart.points.map(function (p, i) { return [n === 1 ? right : (i / (n - 1)) * right, p * h]; });

        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = 1;
        chart.lines.forEach(function (l) {
          ctx.beginPath();
          ctx.moveTo(0, l.y * h);
          ctx.lineTo(w, l.y * h);
          ctx.stroke();
        });
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(0, h);
        xy.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
        ctx.lineTo(right, h);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = c.line;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        xy.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.stroke();

        var end = xy[xy.length - 1];
        ctx.beginPath();
        ctx.arc(end[0], end[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = c.line;
        ctx.fill();

        ctx.font = "12px sans-serif";
        ctx.textBaseline = "bottom";
        chart.lines.forEach(function (l) {   // 分界线的名字写在线的左上方，垫一块卡片底色
          var y = l.y * h - 2;
          var tw = ctx.measureText(l.name).width;
          ctx.fillStyle = c.card;
          ctx.fillRect(0, y - 14, tw + 4, 14);
          ctx.fillStyle = c.grid;
          ctx.fillText(l.name, 0, y);
        });
      });
    }
  }
});
