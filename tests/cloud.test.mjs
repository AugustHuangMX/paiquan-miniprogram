// 三个页面共用的"调云函数"模块。
// 拆页之后最容易出的事就是三份 copy 各自漂移（错误提示不一样、函数名写错一个字母），
// 所以这一段必须只有一份，并且测住。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
const CLOUD_PATH = path.join(MP, "utils", "cloud.js");
if (!existsSync(CLOUD_PATH)) throw new Error("缺少 " + CLOUD_PATH + " —— 先写实现再跑");

const require = createRequire(import.meta.url);

/** 装一个 wx 桩，加载 cloud.js 并返回模块。
 *  注意：桩必须一直留着 —— callCloud 是稍后才调用的，
 *  如果在 require 完就恢复 global.wx，调用时就变成了"不支持云开发"。 */
function loadCloud(wxStub) {
  global.wx = wxStub;
  delete require.cache[require.resolve(CLOUD_PATH)];
  return require(CLOUD_PATH);
}

/** 能记录调用并可编程返回的 wx.cloud 桩 */
function stubWx(behaviour) {
  const calls = [];
  return {
    calls,
    wx: {
      cloud: {
        callFunction(o) {
          calls.push({ name: o.name, data: o.data });
          const r = behaviour(o);
          Promise.resolve().then(() => {
            if (r && r.failWith) o.fail && o.fail({ errMsg: r.failWith });
            else o.success && o.success({ result: r });
          });
        },
      },
    },
  };
}

describe("共用云调用模块", () => {
  test("固定调名为 apex 的云函数，并原样传参", async () => {
    const s = stubWx(() => ({ ok: true, kind: "ok", message: "", data: {} }));
    const cloud = loadCloud(s.wx);
    await cloud.callCloud({ action: "rotation" });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].name, "apex");
    assert.deepEqual(s.calls[0].data, { action: "rotation" });
    assert.equal(cloud.FUNCTION_NAME, "apex");
  });

  test("成功时把 result 原样返回", async () => {
    const s = stubWx(() => ({ ok: true, kind: "ok", message: "", data: { modes: [1, 2] } }));
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.modes, [1, 2]);
  });

  test("云函数调用失败时给出可读中文（含排查方向），而不是抛异常", async () => {
    const s = stubWx(() => ({ failWith: "errMsg: cloud function not found" }));
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "network");
    assert.ok(/云函数/.test(r.message), "要提示是云函数的问题，实际：" + r.message);
    assert.ok(r.message.length > 10, "别只给一句看不懂的英文");
  });

  test("云函数超时（-504003）单独分类，别甩给用户一坨英文和链接", async () => {
    // 真机实测的原样报错，云函数默认超时只有 3 秒，冷启动+请求上游很容易超过
    const raw = "cloud.callFunction:fail Error: errCode: -504003 | errMsg: Invoking task timed out after 3 seconds " +
      "更多错误信息请访问： https://docs.cloudbase.net/error-code/basic/FUNCTIONS_TIME_LIMIT_EXCEEDED " +
      "(callId: 1790604008192-0.365136541520535) (trace: 22:0:8 start->22:0:10 normal poll->22:0:13 system error";
    const s = stubWx(() => ({ failWith: raw }));
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "timeout");
    assert.equal(/https?:\/\//.test(r.message), false, "不该把文档链接甩给用户：" + r.message);
    assert.equal(/callId|trace/.test(r.message), false, "不该把内部调试信息甩给用户");
    assert.ok(r.message.length <= 60, "提示要短，实际 " + r.message.length + " 字：" + r.message);
  });

  test("不管什么错，给用户的提示都有长度上限（原始报错能有 300 字）", async () => {
    const long = "errMsg: " + "x".repeat(400);
    const s = stubWx(() => ({ failWith: long }));
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.ok(r.message.length <= 80, "太长会撑爆界面，实际 " + r.message.length + " 字");
  });

  test("云开发没开通（-601034）也单独分类", async () => {
    const s = stubWx(() => ({ failWith: "cloud.callFunction:fail Error: errCode: -601034 | errMsg: 没有权限，请先开通云开发或者云托管" }));
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, false);
    assert.ok(r.message.length <= 60);
    assert.ok(/云开发|环境/.test(r.message), "要指出是云开发环境的问题：" + r.message);
  });

  test("云函数返回空内容时也不把 undefined 交给页面", async () => {
    const s = stubWx(() => undefined);
    const cloud = loadCloud(s.wx);
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "internal");
    assert.ok(r.message.length > 0);
  });

  test("环境不支持云能力时给可读提示", async () => {
    const cloud = loadCloud({});
    const r = await cloud.callCloud({ action: "rotation" });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "internal");
    assert.ok(/云/.test(r.message));
  });

  test("绝不在这一层吞掉 kind（页面的错误标题全靠它）", async () => {
    for (const kind of ["badkey", "unverified", "ratelimit", "empty", "notfound"]) {
      const s = stubWx(() => ({ ok: false, kind, message: "x" }));
      const cloud = loadCloud(s.wx);
      const r = await cloud.callCloud({ action: "player" });
      assert.equal(r.kind, kind, "kind 被改写成 " + r.kind);
    }
  });
});
