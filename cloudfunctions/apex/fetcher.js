/**
 * 极简 HTTP 客户端，只用 Node 自带的 http/https 模块。
 *
 * 为什么不能直接用 fetch：
 *   微信云开发的 Node 运行时是 **Node 16**，而全局 fetch 是 **Node 18** 才内置的。
 *   云函数里写 fetch 会直接抛 "运行环境不支持 fetch"，真机实测就是这么挂的。
 *   Netlify 那边是 Node 20 所以一直正常 —— 典型的"本地好好的、换个环境就废"。
 *
 * 用内置模块就没有这个版本依赖：Node 8 到 22 都能跑，零依赖。
 */
var https = require("https");
var http = require("http");
var zlib = require("zlib");
var URL = require("url").URL;

// 复用连接。
// Node 16（微信云开发的运行时）里默认的 agent 是 keepAlive:false，
// 意味着每次请求都要重新 DNS + TCP + TLS 握手，多花几百毫秒 ——
// 而云函数默认只给 3 秒，这点开销足以把请求顶超时。
// 云函数实例存活期间连接会被复用，第二个人再查就快很多。
var httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
var httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });

/**
 * @param {string} target 完整 URL
 * @param {{timeoutMs?:number, method?:string, headers?:object}} [opts]
 * @returns {Promise<{ok:boolean, status:number, text:function():Promise<string>}>}
 *          形状刻意和 fetch 的 Response 保持一致，方便调用方替换。
 */
function requestText(target, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var u;
    try {
      u = new URL(target);
    } catch (e) {
      reject(new Error("URL 不合法: " + target));
      return;
    }

    var lib = (u.protocol === "http:") ? http : https;
    var agent = (u.protocol === "http:") ? httpAgent : httpsAgent;
    var settled = false;
    var timer = null;

    function fail(err) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    }

    var req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: opts.method || "GET",
      headers: opts.headers || {},
      agent: agent
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);

        var buf = Buffer.concat(chunks);
        // 我们没发 Accept-Encoding，正常不会被压缩；
        // 但万一上游/中间层压了，不处理就会拿到二进制乱码。
        try {
          var enc = String(res.headers["content-encoding"] || "").toLowerCase();
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "deflate") buf = zlib.inflateSync(buf);
          else if (enc === "br" && typeof zlib.brotliDecompressSync === "function") buf = zlib.brotliDecompressSync(buf);
        } catch (e) {
          fail(new Error("响应解压失败: " + e.message));
          return;
        }

        var status = res.statusCode;
        resolve({
          ok: status >= 200 && status < 300,
          status: status,
          text: function () { return Promise.resolve(buf.toString("utf8")); }
        });
      });
    });

    timer = setTimeout(function () {
      req.destroy();
      var e = new Error("请求超时");
      e.name = "AbortError";        // 与 fetch 的超时错误保持同名，调用方不用改判断
      fail(e);
    }, opts.timeoutMs || 15000);

    req.on("error", function (e) { fail(e); });
    req.end();
  });
}

module.exports = { requestText: requestText };
