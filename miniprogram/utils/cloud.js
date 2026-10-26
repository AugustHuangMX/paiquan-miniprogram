/**
 * 三个页面共用的云函数调用封装。
 *
 * 拆成多页之后，最容易出的问题就是三份 copy 各自漂移：
 * 一个页面把错误提示改了、另一个函数名敲错一个字母，而界面上只是"没反应"。
 * 所以这一段只留一份。
 *
 * 约定：**永远 resolve，不 reject**。页面只需要判断 ok，
 * 不用给每个调用点包 try/catch。
 */

var FUNCTION_NAME = "apex";

// 给用户看的提示必须有长度上限。上游的报错原样能有 400 多字，
// 里面全是 callId、trace、文档链接 —— 甩给用户只会让人一脸问号。
var MAX_MSG = 60;

/**
 * 把云函数返回的英文/内部报错，翻译成用户看得懂的一句话。
 * 原始信息仍然打到控制台，方便在开发者工具里排查。
 */
function classifyCloudFailure(raw) {
  var s = String(raw || "");

  // 每个分支都必须带 ok:false —— 页面靠 r.ok 判断成败。
  // 漏了它虽然因为 undefined 是假值而"看起来能用"，但那是撞对了，不是对。

  // 云函数默认超时只有 3 秒，冷启动 + 请求上游很容易超过。
  // 真机实测报的就是这个（errCode -504003）。
  if (/-504003|timed out|FUNCTIONS_TIME_LIMIT_EXCEEDED/i.test(s)) {
    return { ok: false, kind: "timeout", message: "云函数响应超时了，请稍后重试。" };
  }
  // 云环境没配对（比如 init 没传 env）
  if (/-601034|没有权限|开通云开发/i.test(s)) {
    return { ok: false, kind: "network", message: "云开发环境没配置好，请联系维护者。" };
  }
  // 云函数没上传部署
  if (/not found|FunctionName|函数不存在/i.test(s)) {
    return { ok: false, kind: "network", message: "没找到 apex 云函数，请确认已上传部署。" };
  }

  // 兜底：去掉文档链接，截断到一个合理长度
  var short = s.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (short.length > MAX_MSG) short = short.slice(0, MAX_MSG) + "…";
  return { ok: false, kind: "network", message: "调用云函数失败：" + (short || "未知原因") };
}

/**
 * @param {{action:string, player?:string, platform?:string}} payload
 * @returns {Promise<{ok:boolean, kind:string, message:string, data?:any}>}
 */
function callCloud(payload) {
  return new Promise(function (resolve) {
    if (typeof wx === "undefined" || !wx.cloud) {
      resolve({
        ok: false,
        kind: "internal",
        message: "当前环境不支持云开发，请把开发者工具的调试基础库调到 2.2.3 以上。"
      });
      return;
    }

    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: payload,
      success: function (res) {
        if (res && res.result) {
          resolve(res.result);
        } else {
          resolve({ ok: false, kind: "internal", message: "云函数没有返回内容，请重新编译试试。" });
        }
      },
      fail: function (e) {
        var raw = (e && e.errMsg) ? String(e.errMsg) : "";
        // 原始报错留在控制台，排查时能直接看到完整信息
        console.warn("[apex] 云函数调用失败：", raw);
        resolve(classifyCloudFailure(raw));
      }
    });
  });
}

module.exports = {
  FUNCTION_NAME: FUNCTION_NAME,
  classifyCloudFailure: classifyCloudFailure,
  callCloud: callCloud
};
