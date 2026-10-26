// 云函数 handler 的行为测试（cloudfunctions/apex/handler.js）。
// 打桩 fetch，不需要真的连网；重点守的是"分类对不对"和"缓存有没有生效"。
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = path.resolve(HERE, "..", "cloudfunctions", "apex", "handler.js");

if (!existsSync(HANDLER_PATH)) {
  throw new Error("缺少 " + HANDLER_PATH + " —— 先写实现再跑");
}
const require = createRequire(import.meta.url);

const rotationReal = () => ({
  battle_royale: { current: { start: 1, end: 2, map: "Broken Moon" }, next: { start: 2, end: 3, map: "World's Edge" } },
  ranked: { current: { start: 1, end: 2, map: "Olympus" }, next: { start: 2, end: 3, map: "Broken Moon" } },
  ltm: { current: { start: 1, end: 2, map: "Fragment", eventName: "TDM" }, next: { start: 2, end: 3, map: "Caustic Treatment" } },
  wildcard: { current: { start: 1, end: 2, map: "E-District" }, next: { start: 2, end: 3, map: "Kings Canyon" } },
});

/** 可编程 fetch 桩，记录每次请求 */
function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const r = await handler(String(url), init || {});
    const body = r.body === undefined ? "" : r.body;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

function freshHandler(deps) {
  // 每个用例都重新加载 handler，避免模块级缓存串味
  delete require.cache[require.resolve(HANDLER_PATH)];
  const mod = require(HANDLER_PATH);
  return mod;
}

const KEY = "TEST_KEY_123";

describe("云函数 · 基本校验", () => {
  test("没配 API Key → kind=nokey，并告诉维护者去哪配", async () => {
    const h = freshHandler();
    const r = await h.handle({ action: "rotation" }, { apiKey: "", fetchImpl: stubFetch(() => ({ status: 200, body: {} })) });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "nokey");
    assert.ok(/ALS_API_KEY/.test(r.message), "提示里要点名环境变量名");
  });

  test("不认识的 action → kind=action", async () => {
    const h = freshHandler();
    const r = await h.handle({ action: "delete_everything" }, { apiKey: KEY, fetchImpl: stubFetch(() => ({ status: 200, body: {} })) });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "action");
  });

  test("查玩家缺参数 → 明确报参数问题，不去打上游", async () => {
    const f = stubFetch(() => ({ status: 200, body: {} }));
    const h = freshHandler();
    const r = await h.handle({ action: "player", player: "  " }, { apiKey: KEY, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "badparam");
    assert.equal(f.calls.length, 0, "参数不合法就不该浪费上游配额");
  });
});

describe("云函数 · 请求形状", () => {
  test("绝不发送 Accept 头（带 application/json 会触发上游 406 且丢 CORS 头）", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: f });
    const headers = f.calls[0].init.headers || {};
    assert.equal(headers.Accept || headers.accept, undefined, "不能带 Accept 头");
  });

  test("rotation 请求带 auth 与 version=2", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: f });
    const u = f.calls[0].url;
    assert.match(u, /\/maprotation\?/);
    assert.match(u, /auth=TEST_KEY_123/);
    assert.match(u, /version=2/);
  });

  test("player 请求带 player / platform / version", async () => {
    const f = stubFetch(() => ({ status: 200, body: { global: { name: "shroud" } } }));
    const h = freshHandler();
    await h.handle({ action: "player", player: "shroud", platform: "PC" }, { apiKey: KEY, fetchImpl: f });
    const u = f.calls[0].url;
    assert.match(u, /\/bridge\?/);
    assert.match(u, /player=shroud/);
    assert.match(u, /platform=PC/);
    assert.match(u, /version=5/);
  });

  test("玩家名里的特殊字符会被正确编码，不会污染其它查询参数", async () => {
    const f = stubFetch(() => ({ status: 200, body: { global: { name: "a b&c" } } }));
    const h = freshHandler();
    await h.handle({ action: "player", player: "a b&c", platform: "PC" }, { apiKey: KEY, fetchImpl: f });
    // 用解析后的参数断言，而不是拿正则猜字符串——名字里的 & 若没被编码，
    // 会凭空多出一个查询参数，甚至把 auth 顶掉。
    const u = new URL(f.calls[0].url);
    assert.equal(u.searchParams.get("player"), "a b&c", "player 应原样还原");
    assert.equal(u.searchParams.get("auth"), KEY, "auth 必须完好无损");
    assert.equal(u.searchParams.get("platform"), "PC");
    assert.equal([...u.searchParams.keys()].length, 4, "不该多出意外的参数");
  });
});

describe("云函数 · 错误分类透传", () => {
  const cases = [
    ["非 JSON 的 Key 错误", 404, "Error: API key doesn't exist !", "badkey"],
    ["401 + JSON 无效 Key", 401, JSON.stringify({ Error: "Invalid API key" }), "badkey"],
    ["空 auth 的 Unauthorized format", 200, "Unauthorized format", "badkey"],
    ["没绑 Discord", 429, JSON.stringify({ Error: "You must verify your API account first by linking your Discord account on https://portal.apexlegendsapi.com/discord-auth" }), "unverified"],
    ["真正的频率超限", 429, JSON.stringify({ Error: "Too many requests" }), "ratelimit"],
    ["查无此人", 404, JSON.stringify({ Error: "Player not found" }), "notfound"],
    ["HTTP 200 + 空数组", 200, "[]", "empty"],
    ["HTTP 200 + JSON null", 200, "null", "empty"],
  ];
  for (const [name, status, body, kind] of cases) {
    test(name + " → " + kind, async () => {
      const h = freshHandler();
      const r = await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: stubFetch(() => ({ status, body })) });
      assert.equal(r.ok, false);
      assert.equal(r.kind, kind);
      assert.ok(r.message && r.message.length > 0, "必须有可读提示");
    });
  }

  test("网络层抛错 → network", async () => {
    const h = freshHandler();
    const r = await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    assert.equal(r.kind, "network");
  });

  test("超时 → timeout", async () => {
    const h = freshHandler();
    const r = await h.handle({ action: "rotation" }, {
      apiKey: KEY,
      fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
    });
    assert.equal(r.kind, "timeout");
  });
});

describe("云函数 · 运行环境兼容性", () => {
  // 这是真机发现的 bug：微信云开发的 Node 运行时是 16，**没有全局 fetch**（Node 18 才内置）。
  // Netlify 那边是 Node 20 所以一直没事，微信这边一调就返回
  // {"ok":false,"kind":"network","message":"运行环境不支持 fetch。"}
  // 结论：请求上游不能依赖全局 fetch，必须有内置实现。
  test("没有全局 fetch 时（微信云开发 Node 16 就没有）依然能请求上游", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rotationReal()));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const realFetch = globalThis.fetch;
    let result;
    try {
      globalThis.fetch = undefined;              // 模拟微信云开发的运行时
      const h = freshHandler();
      result = await h.handle({ action: "rotation" }, {
        apiKey: KEY,
        baseUrl: "http://127.0.0.1:" + port,     // 指到本地桩服务器
      });
    } finally {
      globalThis.fetch = realFetch;
      server.close();
    }

    assert.equal(result.ok, true,
      "环境没有 fetch 就不该直接失败，应当有内置的请求实现。实际：" + JSON.stringify(result));
    assert.equal(result.data.modes.length, 4);
    assert.equal(result.data.modes[0].current.map, "Olympus");
  });

  test("内置请求实现也要能正确处理非 2xx 与错误正文", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Error: API key doesn't exist !");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const realFetch = globalThis.fetch;
    let result;
    try {
      globalThis.fetch = undefined;
      const h = freshHandler();
      result = await h.handle({ action: "rotation" }, { apiKey: "WRONG", baseUrl: "http://127.0.0.1:" + port });
    } finally {
      globalThis.fetch = realFetch;
      server.close();
    }
    assert.equal(result.ok, false);
    assert.equal(result.kind, "badkey", "内置实现也要把错误分类对");
  });
});

describe("云函数 · 超时设置", () => {
  // 真机实测：云函数默认超时只有 3 秒，冷启动 + 请求上游直接超时，
  // 报出来的是 -504003 一大坨英文。两件事都要做：
  //   1) 在控制台把云函数超时时间调大（比如 20 秒）
  //   2) 我们自己的超时必须明显小于平台上限，否则会被平台掐掉、报错很难看
  test("我们自己的默认超时要留够余量（平台掐掉时报错很难看，不如我们主动超时）", () => {
    const src = readFileSync(HANDLER_PATH, "utf8");
    const m = src.match(/DEFAULT_TIMEOUT\s*=\s*(\d+)/);
    assert.ok(m, "找不到 DEFAULT_TIMEOUT");
    const ms = Number(m[1]);
    assert.ok(ms <= 10000,
      "默认超时应 <= 10 秒（给平台 20 秒上限留一半余量），实际 " + ms + "ms");
    assert.ok(ms >= 3000, "也别太短，否则正常请求都会被误判超时：" + ms + "ms");
  });

  test("默认超时确实生效（不传 timeoutMs 时用它）", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: f });
    const t = f.calls[0].init.timeoutMs;
    assert.equal(typeof t, "number", "应当把超时时间传给请求实现");
    assert.ok(t <= 10000, "实际 " + t);
  });
});

describe("云函数 · 猎杀底分涨幅（store 注入）", () => {
  const H = 3600 * 1000;
  const NOW = 1800000000000;
  const predReal = () => ({ RP: {
    PC: { val: 28685, foundRank: 750, totalMastersAndPreds: 4000, updateTimestamp: Math.round((NOW - 600000) / 1000) },
    PS4: { val: 24000, foundRank: 750, totalMastersAndPreds: 2000, updateTimestamp: Math.round((NOW - 600000) / 1000) },
  } });

  /** 假 store：记录调用次数，行为可编排 */
  const fakeStore = (opts = {}) => {
    const calls = { read: 0, write: 0, written: [] };
    return {
      calls,
      readBasis: async (nowMs) => {
        calls.read++;
        if (opts.readThrows) throw new Error("库挂了");
        if (opts.readHangs) return new Promise(() => {});
        return opts.basis === undefined
          ? { at: nowMs - 24 * H, plats: { PC: { rp: 27445 }, PS4: { rp: 24100 } } }
          : opts.basis;
      },
      writeCurrent: async (group, nowMs) => {
        calls.write++;
        if (opts.writeThrows) throw new Error("写不进去");
        calls.written.push({ group, nowMs });
      },
    };
  };

  test("不注入 store 时一切照旧，只是没有涨幅（网页版就是这样）", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW });
    assert.equal(r.ok, true);
    assert.equal(r.data.group.plats[0].delta, undefined, "没有 store 就不该凭空造一个涨幅出来");
  });

  test("注入 store 且有基准时，涨幅出现在返回里", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore();
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    const pc = r.data.group.plats.find((p) => p.code === "PC");
    assert.equal(pc.delta, 28685 - 27445);
    assert.equal(pc.deltaBasisAt, NOW - 24 * H);
    assert.equal(store.calls.read, 1);
    assert.equal(store.calls.write, 1, "还要把当前值记一条，供明天对比");
    assert.ok(store.calls.written[0].group.plats.length, "写库用的是归一化后的分组");
  });

  test("读基准抛异常 → 用户照常看到分数线，只是没有涨幅（这是最重要的一条）", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore({ readThrows: true });
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    assert.equal(r.ok, true, "库挂了也绝不能影响主功能");
    assert.equal(r.data.group.plats[0].rp, 28685);
    assert.equal(r.data.group.plats[0].delta, null);
  });

  test("读基准一直不返回（库卡住）→ 有超时保护，不会把整次请求拖死", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore({ readHangs: true });
    const t0 = Date.now();
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    const cost = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.equal(r.data.group.plats[0].delta, null);
    assert.ok(cost < 3000, "应当被自己的超时掐掉，实际花了 " + cost + "ms");
  });

  test("写快照失败不影响返回，也不抹掉已经算好的涨幅", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore({ writeThrows: true });
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    assert.equal(r.ok, true);
    assert.equal(r.data.group.plats.find((p) => p.code === "PC").delta, 1240);
  });

  test("库里还没有基准（第一次上线）→ delta 为 null，界面据此不显示那一行", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore({ basis: null });
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    assert.equal(r.ok, true);
    r.data.group.plats.forEach((p) => assert.equal(p.delta, null));
    assert.equal(store.calls.write, 1, "即使没有基准也要记这一条，明天就有基准了");
  });

  test("命中缓存时不重复读库写库（省额度）", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const store = fakeStore();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store };
    await h.handle({ action: "predator" }, deps);
    await h.handle({ action: "predator" }, deps);
    assert.equal(store.calls.read, 1);
    assert.equal(store.calls.write, 1);
  });

  test("其它 action 完全不碰 store（地图轮换没必要查库）", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    const store = fakeStore();
    await h.handle({ action: "rotation" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: store });
    assert.equal(store.calls.read, 0);
    assert.equal(store.calls.write, 0);
  });

  test("store 的接口不完整（只有一半方法）也不该崩", async () => {
    const f = stubFetch(() => ({ status: 200, body: predReal() }));
    const h = freshHandler();
    const r = await h.handle({ action: "predator" }, { apiKey: KEY, fetchImpl: f, now: () => NOW, snapshots: { readBasis: async () => null } });
    assert.equal(r.ok, true);
    assert.equal(r.data.group.plats[0].delta, null);
  });
});

describe("云函数 · 用 uid 精确查（解决同名）", () => {
  const bridgeOk = (name) => ({ global: { name, uid: "2262951949", platform: "PC", level: 255 } });
  // 实测：查不到的人上游返回 404 + {"Error":"Player not found..."}
  const notFound = { status: 404, body: { Error: "Player not found. Alternatively, we may have encountered an issue while connecting to low priority search service." } };

  test("传了 uid 就直接按 uid 查，不按名字查", async () => {
    const f = stubFetch((url) => ({ status: 200, body: bridgeOk(url.includes("uid=") ? "正确的人" : "同名的人") }));
    const h = freshHandler();
    const r = await h.handle({ action: "player", uid: "2262951949", platform: "PC" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.ok, true, r.message);
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /uid=2262951949/);
    assert.equal(/[?&]player=/.test(f.calls[0].url), false, "既然是 uid 查，就不要再拼 player 参数");
    assert.equal(r.data.player.name, "正确的人");
  });

  test("输入像 uid、但按名字查不到 → 自动再按 uid 试一次", async () => {
    const f = stubFetch((url) => url.includes("uid=")
      ? { status: 200, body: bridgeOk("uid 查到的人") }
      : notFound);
    const h = freshHandler();
    const r = await h.handle({ action: "player", player: "2262951949", platform: "PC" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.ok, true, r.message);
    assert.equal(f.calls.length, 2, "总共两次：先名字、后 uid");
    assert.match(f.calls[0].url, /player=2262951949/);
    assert.match(f.calls[1].url, /uid=2262951949/);
    assert.equal(r.data.player.name, "uid 查到的人");
  });

  test("普通的玩家名查不到时不多打一次（省上游额度）", async () => {
    const f = stubFetch(() => notFound);
    const h = freshHandler();
    const r = await h.handle({ action: "player", player: "zzz_not_exist", platform: "PC" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "notfound");
    assert.equal(f.calls.length, 1, "名字不像 uid 就不该重试");
  });

  test("纯数字的玩家名如果真存在，按名字那次就成功了，不会去查 uid", async () => {
    const f = stubFetch(() => ({ status: 200, body: bridgeOk("数字名字的人") }));
    const h = freshHandler();
    const r = await h.handle({ action: "player", player: "123456789", platform: "PC" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 1, "名字查到了就不该再试 uid");
    assert.equal(r.data.player.name, "数字名字的人");
  });

  test("uid 字段格式不对时忽略它，按名字查", async () => {
    const f = stubFetch(() => ({ status: 200, body: bridgeOk("按名字查到") }));
    const h = freshHandler();
    await h.handle({ action: "player", uid: "not-a-uid", player: "shroud", platform: "PC" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /player=shroud/);
  });

  test("只给了 uid（没有 player）不该被当成「缺参数」", async () => {
    const f = stubFetch(() => ({ status: 200, body: bridgeOk("uid 查的") }));
    const h = freshHandler();
    const r = await h.handle({ action: "player", uid: "2262951949" },
      { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.ok, true, r.message);
    assert.notEqual(r.kind, "badparam");
  });

  test("名字和 uid 都没给才报缺参数", async () => {
    const f = stubFetch(() => ({ status: 200, body: bridgeOk("x") }));
    const h = freshHandler();
    const r = await h.handle({ action: "player" }, { apiKey: KEY, fetchImpl: f, now: () => 1000 });
    assert.equal(r.kind, "badparam");
    assert.equal(f.calls.length, 0, "不该浪费一次上游调用");
  });
});

describe("云函数 · 缓存", () => {
  test("连续两次 rotation 只打一次上游（保护出网流量与上游配额）", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => 1000 };
    const a = await h.handle({ action: "rotation" }, deps);
    const b = await h.handle({ action: "rotation" }, deps);
    assert.equal(f.calls.length, 1, "第二次应当命中缓存");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.cached, true);
    assert.equal(a.cached, false);
  });

  test("缓存过期后会重新打上游", async () => {
    const f = stubFetch(() => ({ status: 200, body: rotationReal() }));
    const h = freshHandler();
    let t = 1000;
    const deps = { apiKey: KEY, fetchImpl: f, now: () => t };
    await h.handle({ action: "rotation" }, deps);
    t += 10 * 60 * 1000;
    await h.handle({ action: "rotation" }, deps);
    assert.equal(f.calls.length, 2, "过期后必须重新取");
  });

  test("失败结果不进缓存（否则一次抖动会污染整个 TTL）", async () => {
    let n = 0;
    const f = stubFetch(() => {
      n++;
      return n === 1 ? { status: 500, body: "<html>boom</html>" } : { status: 200, body: rotationReal() };
    });
    const h = freshHandler();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => 1000 };
    const a = await h.handle({ action: "rotation" }, deps);
    const b = await h.handle({ action: "rotation" }, deps);
    assert.equal(a.ok, false);
    assert.equal(b.ok, true, "上一次失败不该影响下一次");
  });

  test("玩家查询不缓存（不同人查不同玩家）", async () => {
    const f = stubFetch(() => ({ status: 200, body: { global: { name: "shroud" } } }));
    const h = freshHandler();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => 1000 };
    await h.handle({ action: "player", player: "shroud", platform: "PC" }, deps);
    await h.handle({ action: "player", player: "shroud", platform: "PC" }, deps);
    assert.equal(f.calls.length, 2);
  });

  test("rotation 与 predator 各自独立缓存，不互相顶掉", async () => {
    const f = stubFetch((url) => ({ status: 200, body: url.includes("predator") ? { RP: { PC: { val: 1, foundRank: 1, totalMastersAndPreds: 2 } } } : rotationReal() }));
    const h = freshHandler();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => 1000 };
    const a = await h.handle({ action: "rotation" }, deps);
    const b = await h.handle({ action: "predator" }, deps);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(f.calls.length, 2);
  });

  test("servers 也走缓存（这一页每次进都要看，额度不能这么花）", async () => {
    const f = stubFetch(() => ({ status: 200, body: { Origin_login: { Asia: { Status: "UP", ResponseTime: 8 } } } }));
    const h = freshHandler();
    const deps = { apiKey: KEY, fetchImpl: f, now: () => 1000 };
    const a = await h.handle({ action: "servers" }, deps);
    const b = await h.handle({ action: "servers" }, deps);
    assert.equal(f.calls.length, 1);
    assert.equal(a.cached, false);
    assert.equal(b.cached, true);
  });

  test("服务器状态变化快，缓存时间必须比猎杀分数线短", () => {
    const ttl = freshHandler().CACHE_TTL;
    assert.ok(ttl.servers > 0);
    assert.ok(ttl.servers <= 2 * 60 * 1000, "状态可能随时恢复，缓存太久会一直显示已经不存在的故障");
    assert.ok(ttl.servers < ttl.predator, "分数线按小时更新，服务器状态按分钟");
  });
});

describe("云函数 · 服务器状态", () => {
  const serversReal = () => ({
    Origin_login: { Asia: { Status: "UP", HTTPCode: 200, ResponseTime: 8 } },
    EA_novafusion: { Asia: { Status: "DOWN", HTTPCode: 503, ResponseTime: 0 } },
    otherPlatforms: { "Xbox-Live": { Status: "UP" } },
  });

  test("打的是 /servers，且不带 version（这个接口没有版本参数）", async () => {
    const f = stubFetch(() => ({ status: 200, body: serversReal() }));
    const h = freshHandler();
    await h.handle({ action: "servers" }, { apiKey: KEY, fetchImpl: f });
    const u = f.calls[0].url;
    assert.match(u, /\/servers\?/);
    assert.equal(/version=/.test(u), false, "多送参数没有意义，还会被上游当成特性差异");
    assert.match(u, /auth=/);
  });

  test("归一化后放在 data.servers，界面上要用的字段都在", async () => {
    const f = stubFetch(() => ({ status: 200, body: serversReal() }));
    const h = freshHandler();
    const r = await h.handle({ action: "servers" }, { apiKey: KEY, fetchImpl: f });
    assert.equal(r.ok, true);
    const s = r.data.servers;
    assert.ok(s, "必须给出归一化结果");
    assert.equal(s.summary.problem, 1);
    assert.equal(s.groups.find((g) => g.key === "EA_novafusion").status, "DOWN");
    assert.equal(s.groups.find((g) => g.key === "Origin_login").label, "登录服务");
  });

  test("上游返回空对象时按既有分类报 empty，不把它当成一份正常数据", async () => {
    const f = stubFetch(() => ({ status: 200, body: {} }));
    const h = freshHandler();
    const r = await h.handle({ action: "servers" }, { apiKey: KEY, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "empty");
  });

  test("响应有效但没有可展示的分组时给空壳，不硬凑一行「全部正常」", async () => {
    // selfCoreTest 是我们刻意不展示的那一组：数据是好的，但没有能给用户看的内容
    const f = stubFetch(() => ({ status: 200, body: { selfCoreTest: { "Status-website": { Status: "UP" } } } }));
    const h = freshHandler();
    const r = await h.handle({ action: "servers" }, { apiKey: KEY, fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.data.servers, null);
  });

  test("上游出错按既有分类上报，不会因为新 action 就走别的路", async () => {
    const f = stubFetch(() => ({ status: 500, body: "<html>boom</html>" }));
    const h = freshHandler();
    const r = await h.handle({ action: "servers" }, { apiKey: KEY, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "http");
  });
});
