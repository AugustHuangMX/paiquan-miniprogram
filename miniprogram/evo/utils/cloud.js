/**
 * Evo 战绩调云函数 evo_mp（同 utils/cloud.js 的约定：**永远 resolve，不 reject**）。
 * 成功：{ ok: true, data }；失败：{ ok: false, code }，code 是云函数回的错误代号或 "network"，
 * 给人看的话由 evo/utils/view.js 的 errText 按语言给（云函数不回中文，免得英文模式露出中文）。
 */
var view = require("./view.js");

var FUNCTION_NAME = "evo_mp";

function callEvo(action, data) {
  return new Promise(function (resolve) {
    if (typeof wx === "undefined" || !wx.cloud) {
      resolve({ ok: false, code: "network" });
      return;
    }
    var payload = { action: action };
    Object.keys(data || {}).forEach(function (k) { payload[k] = data[k]; });
    wx.cloud.callFunction({ name: FUNCTION_NAME, data: payload }).then(function (res) {
      var r = (res && res.result) || {};
      if (r.ok === true) resolve({ ok: true, data: r });
      else resolve({ ok: false, code: r.error || "server" });
    }).catch(function (err) {
      console.warn("evo_mp 调用失败", action, err);
      resolve({ ok: false, code: "network" });
    });
  });
}

/**
 * 扫码绑定：扫电脑上 Evo 设置页里的码（小程序码或 Evo 自己画的二维码），扫到了就打开绑定页确认。
 * wx.scanCode 不在 tests/static.test.mjs 的隐私接口黑名单里（微信《用户隐私保护指引》也不要求声明它）。
 */
function scanToBind(T) {
  wx.scanCode({
    onlyFromCamera: false,
    scanType: ["qrCode", "wxCode"],
    success: function (res) {
      var code = view.bindCodeFrom(res.result) || view.bindCodeFrom(res.path);
      if (!code) {
        wx.showModal({ title: T.evoNotEvoCode, content: T.evoNotEvoCodeBody, showCancel: false });
        return;
      }
      wx.navigateTo({ url: "/evo/bind/bind?c=" + code });
    },
    fail: function (err) {
      var msg = (err && err.errMsg) || "";
      if (/cancel/.test(msg)) return;
      if ((err && err.errno === 112) || /privacy/i.test(msg)) {
        wx.showModal({ title: T.evoScanPrivacy, content: T.evoScanPrivacyBody, showCancel: false });
        return;
      }
      wx.showToast({ title: T.evoScanFail, icon: "none" });
    }
  });
}

module.exports = {
  FUNCTION_NAME: FUNCTION_NAME,
  callEvo: callEvo,
  scanToBind: scanToBind
};
