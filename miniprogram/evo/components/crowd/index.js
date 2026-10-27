/**
 * 首页「大家在玩什么」（2026-10-27）：所有 Evo 玩家近 7 天的热门传奇、场均名次最好的三人组合。
 *
 * 云函数 crowd 算一次管 30 分钟，这里也不用常读：切回首页时超过 10 分钟才重读。
 * Evo 玩家不够多（云函数回 enough: false）或取不到时整块不显示（不编数据，也不在首页糊一个报错）。
 */
var i18n = require("../../../utils/i18n.js");
var view = require("../../utils/view.js");
var evoCloud = require("../../utils/cloud.js");

var STALE_MS = 10 * 60 * 1000;

Component({
  options: { styleIsolation: "apply-shared" },   // 用 app.wxss 的令牌和首页的 .hsec / .hcard / .hpair / .hbar

  properties: {
    lang: { type: String, value: "zh" }
  },

  data: {
    T: i18n.T("zh"),
    v: null
  },

  observers: {
    lang: function (lang) {
      this.setData({ T: i18n.T(lang) });
      this.rebuild();
    }
  },

  lifetimes: {
    attached: function () {
      this.load();
    }
  },

  pageLifetimes: {
    show: function () {
      if (this.loadedAt && Date.now() - this.loadedAt > STALE_MS) this.load();
    }
  },

  methods: {
    load: function () {
      var self = this;
      return evoCloud.callEvo("crowd").then(function (r) {
        if (!r.ok) return;   // 取不到：保留上一次的（第一次就取不到就一直不显示）
        self.loadedAt = Date.now();
        self._raw = r.data;
        self.rebuild();
      });
    },

    rebuild: function () {
      if (!this._raw) return;
      this.setData({ v: view.crowdView(this._raw, this.data.T) });
    }
  }
});
