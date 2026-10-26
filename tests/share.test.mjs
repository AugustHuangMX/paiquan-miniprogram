// 分享链接（带玩家参数）的行为测试。
//
// 这一块是"外部输入"：分享出去的链接谁都能改，参数会直接进查询请求。
// 所以既要挡住脏参数，又要保证**我们自己生成的链接一定能被自己解析回来** ——
// 后者用一条往返属性来钉（见最后一组）。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VM_PATH = path.resolve(HERE, "..", "miniprogram", "utils", "viewmodel.js");
if (!existsSync(VM_PATH)) throw new Error("缺少 " + VM_PATH);
const require = createRequire(import.meta.url);
const vm = require(VM_PATH);

/** 模拟小程序把 path 上的 query 解析成 onLoad(options) 的样子 */
function optionsOf(p) {
  const q = String(p).split("?")[1] || "";
  const out = {};
  for (const kv of q.split("&")) {
    if (!kv) continue;
    const i = kv.indexOf("=");
    if (i < 0) { out[kv] = ""; continue; }
    out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  }
  return out;
}

describe("分享参数 · 解析", () => {
  test("正常的分享参数解析出玩家与平台下标", () => {
    assert.deepEqual(vm.parseShare({ player: "shroud", platform: "PC" }), { player: "shroud", platformIndex: 0, uid: "" });
    assert.deepEqual(vm.parseShare({ player: "x", platform: "PS4" }), { player: "x", platformIndex: 1, uid: "" });
    assert.deepEqual(vm.parseShare({ player: "x", platform: "X1" }), { player: "x", platformIndex: 2, uid: "" });
    assert.deepEqual(vm.parseShare({ player: "x", platform: "SWITCH" }), { player: "x", platformIndex: 3, uid: "" });
  });

  test("大小写不敏感，且去掉首尾空格", () => {
    assert.deepEqual(vm.parseShare({ player: "  shroud  ", platform: "pc" }), { player: "shroud", platformIndex: 0, uid: "" });
  });

  test("没有玩家参数就不查（宁可什么都不做，也别拿空名字打接口）", () => {
    assert.equal(vm.parseShare({}), null);
    assert.equal(vm.parseShare({ player: "" }), null);
    assert.equal(vm.parseShare({ player: "   " }), null);
    assert.equal(vm.parseShare({ player: null }), null);
    assert.equal(vm.parseShare(null), null);
    assert.equal(vm.parseShare(undefined), null);
  });

  test("平台缺失或不认识时退回第一个平台，但玩家名要留着", () => {
    assert.deepEqual(vm.parseShare({ player: "shroud" }), { player: "shroud", platformIndex: 0, uid: "" });
    assert.deepEqual(vm.parseShare({ player: "shroud", platform: "NES" }), { player: "shroud", platformIndex: 0, uid: "" });
    assert.deepEqual(vm.parseShare({ player: "shroud", platform: "" }), { player: "shroud", platformIndex: 0, uid: "" });
  });

  test("超长玩家名直接拒绝（别拿它去打接口）", () => {
    assert.equal(vm.parseShare({ player: "x".repeat(33) }), null);
    assert.ok(vm.parseShare({ player: "x".repeat(32) }), "刚好 32 位要放行");
  });

  test("控制字符与换行一律拒绝（会被拼进请求参数）", () => {
    assert.equal(vm.parseShare({ player: "sh\r\nroud" }), null);
    assert.equal(vm.parseShare({ player: "sh\u0000roud" }), null);
    assert.equal(vm.parseShare({ player: "sh\u007froud" }), null);
  });

  test("名字里的空格、符号、中文都要保留（ID 本来就可能长这样）", () => {
    assert.equal(vm.parseShare({ player: "A B" }).player, "A B");
    assert.equal(vm.parseShare({ player: "O'Brien" }).player, "O'Brien");
    assert.equal(vm.parseShare({ player: "玩家一号" }).player, "玩家一号");
    assert.equal(vm.parseShare({ player: "a&b=c?d" }).player, "a&b=c?d");
  });

  test("非字符串的 player 也当成名字处理（不因为类型就崩）", () => {
    assert.deepEqual(vm.parseShare({ player: 12345 }), { player: "12345", platformIndex: 0, uid: "" });
  });
});

describe("分享参数 · 生成链接", () => {
  test("正常生成小程序页面路径", () => {
    assert.equal(vm.sharePath("predator", "shroud", "PC"), "/pages/predator/predator?player=shroud&platform=PC");
    assert.equal(vm.sharePath("predator", "shroud", "X1"), "/pages/predator/predator?player=shroud&platform=X1");
  });

  test("特殊字符会被转义，不会把 query 撑破", () => {
    const p = vm.sharePath("predator", "A B&c", "PC");
    assert.equal(p, "/pages/predator/predator?player=A%20B%26c&platform=PC");
    assert.equal(optionsOf(p).player, "A B&c", "转义后要能原样解回来");
  });

  test("没有玩家名时只给页面路径（分享这一页，而不是一条坏链接）", () => {
    assert.equal(vm.sharePath("predator", "", "PC"), "/pages/predator/predator");
    assert.equal(vm.sharePath("predator", null, "PC"), "/pages/predator/predator");
    assert.equal(vm.sharePath("predator", "   ", "PC"), "/pages/predator/predator");
  });

  test("名字不符合规则时同样只给页面路径（保证生成的链接一定能打开）", () => {
    assert.equal(vm.sharePath("predator", "x".repeat(33), "PC"), "/pages/predator/predator");
    assert.equal(vm.sharePath("predator", "a\r\nb", "PC"), "/pages/predator/predator");
  });
});

describe("分享参数 · uid（解决同名）", () => {
  test("有 uid 时链接里带上它 —— 好友点开一定是同一个人", () => {
    const p = vm.sharePath("predator", "小明", "PC", "2262951949");
    assert.match(p, /player=/);
    assert.match(p, /uid=2262951949/);
    assert.match(p, /platform=PC/);
  });

  test("uid 格式不对就不写进链接（别产出查不到的链接）", () => {
    assert.equal(/uid=/.test(vm.sharePath("predator", "小明", "PC", "abc")), false);
  });

  test("只有 uid、没有名字时也能生成链接", () => {
    assert.equal(vm.sharePath("predator", "", "PC", "2262951949"), "/pages/predator/predator?uid=2262951949&platform=PC");
  });

  test("名字和 uid 都没有 → 只给页面路径", () => {
    assert.equal(vm.sharePath("predator", "", "PC", ""), "/pages/predator/predator");
  });

  test("解析时把 uid 带出来", () => {
    assert.deepEqual(vm.parseShare({ player: "小明", platform: "PC", uid: "2262951949" }),
      { player: "小明", platformIndex: 0, uid: "2262951949" });
  });

  test("只有 uid 时也要能解析（这时候 player 是空串）", () => {
    const q = vm.parseShare({ uid: "2262951949" });
    assert.ok(q, "只有 uid 也该认");
    assert.equal(q.player, "");
    assert.equal(q.uid, "2262951949");
  });

  test("uid 是脏数据时当成没有，不影响按名字查", () => {
    assert.equal(vm.parseShare({ player: "小明", uid: "abc" }).uid, "");
    assert.equal(vm.parseShare({ player: "小明", uid: "12" }).uid, "");
    assert.equal(vm.parseShare({ uid: "abc" }), null, "只有脏 uid、又没名字 → 整条参数作废");
  });

  test("往返：uid 一定要原样回来（这是「发给朋友必定是同一人」的保证）", () => {
    for (const uid of ["2262951949", "1421238789137568352", "123456"]) {
      const p = vm.sharePath("predator", "某人", "X1", uid);
      const q = vm.parseShare(optionsOf(p));
      assert.equal(q.uid, uid, "uid 往返不一致：" + p);
      assert.equal(q.player, "某人");
      assert.equal(q.platformIndex, 2);
    }
  });
});

describe("分享参数 · 往返一致", () => {
  test("自己生成的链接，自己一定解析得回来（同一个人、同一个平台）", () => {
    const names = ["shroud", "A B", "O'Brien", "玩家一号", "a&b=c?d", "#137", "x".repeat(32), "%20", "100%"];
    for (const name of names) {
      for (const [i, code] of ["PC", "PS4", "X1", "SWITCH"].entries()) {
        const path = vm.sharePath("predator", name, code);
        const q = vm.parseShare(optionsOf(path));
        assert.ok(q, name + " 的链接解析失败了：" + path);
        assert.equal(q.player, name, "玩家名往返不一致：" + path);
        assert.equal(q.platformIndex, i, "平台往返不一致：" + path);
      }
    }
  });
});
