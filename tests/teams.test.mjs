// 战队专区（cloudfunctions/apex/teams.js）的测试。
// 验证：读名单、逐人取分、按队分组、字段格式化、输入方式映射成中文，
// 以及最重要的一条 —— **未定级的账号不展示**。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const teams = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "teams.js"));

const KEY = "test-key";
const playerJson = (score) => JSON.stringify({
  global: { name: "p", uid: "1", platform: "PC", level: 500, rank: { rankName: "Diamond", rankDiv: 2, rankScore: score } },
});

const flatOf = (r) => r.data.teams.reduce((a, t) => a.concat(t.players), []);

describe("teams", () => {
  test("有排位分的选手才展示：按队分组、字段格式化", async () => {
    teams._clearCache();
    const r = await teams.handle({}, {
      apiKey: KEY,
      fetchImpl: () => ({ status: 200, text: async () => playerJson(12345) }),
    });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.data.teams));
    assert.ok(r.data.teams.length >= 8, "至少 8 支队，实际 " + r.data.teams.length);

    const flat = flatOf(r);
    assert.ok(flat.length >= 15, "至少 15 名选手，实际 " + flat.length);
    assert.ok(flat.every((p) => typeof p.rankScoreText === "string" && p.rankScoreText.length > 0));
    assert.equal(flat[0].rankScoreText, "12,345", "分数要带千分位");
    assert.ok(flat.some((p) => p.input === "手柄"), "要有手柄标注");
    assert.ok(flat.some((p) => p.input === "键鼠"), "要有键鼠标注");
  });

  test("未定级（0 分）的账号一律不展示（撞名的别人、选手的备用号都在这类里）", async () => {
    teams._clearCache();
    const r = await teams.handle({}, {
      apiKey: KEY,
      fetchImpl: () => ({ status: 200, text: async () => playerJson(0) }),
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.teams, [], "一个未定级的都不该出现");
  });

  test("取不到数据的选手也不展示（不留「—」占位）", async () => {
    teams._clearCache();
    const r = await teams.handle({}, {
      apiKey: KEY,
      fetchImpl: () => ({ status: 404, text: async () => JSON.stringify({ Error: "Player not found." }) }),
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.teams, []);
  });
});
