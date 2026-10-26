// 定时轮询（cloudfunctions/apex/trackerPoll.js）的测试。
// 验证：全刷、安全阀分片、单个失败不中断整批。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tp = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "trackerPoll.js"));

const KEY = "test-key";
const NOW = 1800000000000;

const playerJson = (uid) => JSON.stringify({
  global: { name: "p" + uid, uid, platform: "PC", level: 100, rank: { rankName: "Platinum", rankDiv: 3, rankScore: 8000 } },
});

function makeStore(list) {
  const store = { writes: [], touches: [], all: async () => list || [] };
  store.writeSnapshot = async (uid, p, ms) => store.writes.push({ uid, p, ms });
  store.touchTracked = async (uid, p) => store.touches.push({ uid, p });
  return store;
}

function deps(store) {
  return {
    apiKey: KEY,
    playerStore: store,
    now: () => NOW,
    fetchImpl: (url) => {
      const m = String(url).match(/uid=([^&]+)/);
      return { status: 200, text: async () => playerJson(m ? m[1] : "0") };
    },
  };
}

describe("trackerPoll", () => {
  test("没 store → 直接返回不崩", async () => {
    const r = await tp.poll({});
    assert.equal(r.polled, 0);
    assert.equal(r.reason, "no store");
  });

  test("名单空 → polled 0", async () => {
    const r = await tp.poll(deps(makeStore([])));
    assert.equal(r.polled, 0);
    assert.equal(r.total, 0);
  });

  test("名单不满阈值 → 全刷，每人写一条快照并回写最新分数", async () => {
    const list = [{ uid: "1", platform: "PC" }, { uid: "2", platform: "PC" }, { uid: "3", platform: "PC" }];
    const store = makeStore(list);
    const r = await tp.poll(deps(store));
    assert.equal(r.polled, 3);
    assert.equal(r.divisor, 1);
    assert.equal(store.writes.length, 3);
    assert.equal(store.touches.length, 3);
  });

  test("超过 200 人 → divisor 2，只刷一部分（自动降频）", async () => {
    const list = [];
    for (let i = 0; i < 250; i++) list.push({ uid: String(1000000000 + i), platform: "PC" });
    const store = makeStore(list);
    const r = await tp.poll(deps(store));
    assert.equal(r.divisor, 2);
    assert.equal(r.polled + r.skipped, 250);
    assert.ok(r.polled < 250, "必须只刷一部分，实际 " + r.polled);
    assert.equal(store.writes.length, r.polled);
  });

  test("超过 400 人 → divisor 4", async () => {
    const list = [];
    for (let i = 0; i < 450; i++) list.push({ uid: String(1000000000 + i), platform: "PC" });
    const store = makeStore(list);
    const r = await tp.poll(deps(store));
    assert.equal(r.divisor, 4);
    assert.equal(r.polled + r.skipped, 450);
  });

  test("单个玩家抓不到不中断整批", async () => {
    const list = [{ uid: "1", platform: "PC" }, { uid: "bad", platform: "PC" }, { uid: "3", platform: "PC" }];
    const store = makeStore(list);
    const d = deps(store);
    d.fetchImpl = (url) => {
      if (String(url).includes("uid=bad")) {
        return { status: 404, text: async () => JSON.stringify({ Error: "Player not found." }) };
      }
      const m = String(url).match(/uid=([^&]+)/);
      return { status: 200, text: async () => playerJson(m[1]) };
    };
    const r = await tp.poll(d);
    assert.equal(r.polled, 3, "尝试过所有 uid");
    assert.equal(store.writes.length, 2, "坏的那个不写快照");
  });
});
