// 服务器状态（/servers）的归一化与展示测试。
//
// 真实响应的形状（实测）：
//   { Origin_login:{ "EU-West":{Status,HTTPCode,ResponseTime,QueryTimestamp}, ... },  ← 按大区分
//     EA_novafusion:{...}, EA_accounts:{...}, ApexOauth_Crossplay:{...},
//     selfCoreTest:{ "Status-website":{...}, "Origin-API":{...} },                    ← 按内部服务分
//     otherPlatforms:{ "Playstation-Network":{Status,QueryTimestamp}, "Xbox-Live":{...} } }
// 注意最后两组的键名不是大区，而且 otherPlatforms **没有** ResponseTime。
//
// 这块最容易出的错是"把没见过的状态当成正常"：那会在服务器真挂时给人看一片绿。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, "..", "miniprogram");
for (const p of [path.join(MP, "utils", "core.js"), path.join(MP, "utils", "viewmodel.js")]) {
  if (!existsSync(p)) throw new Error("缺少 " + p);
}
const require = createRequire(import.meta.url);
const core = require(path.join(MP, "utils", "core.js"));
const vm = require(path.join(MP, "utils", "viewmodel.js"));

const leaf = (status, ms, code) => {
  const o = { Status: status, QueryTimestamp: 1790607903 };
  if (ms != null) o.ResponseTime = ms;
  if (code != null) o.HTTPCode = code;
  return o;
};

/** 造一份和真实响应同形状的数据 */
const servers = (over = {}) => {
  const regions = () => ({
    "EU-West": leaf("UP", 40, 200), "EU-East": leaf("UP", 60, 200),
    "US-West": leaf("UP", 4, 200), "US-Central": leaf("UP", 5, 200),
    "US-East": leaf("UP", 6, 200), "SouthAmerica": leaf("UP", 7, 200),
    "Asia": leaf("UP", 8, 200),
  });
  return Object.assign({
    Origin_login: regions(),
    EA_novafusion: regions(),
    EA_accounts: regions(),
    ApexOauth_Crossplay: regions(),
    selfCoreTest: {
      "Status-website": leaf("UP", 88, 200), "Stats-API": leaf("UP", 90, 200),
      "Overflow-#1": leaf("UP", 91, 200), "Overflow-#2": leaf("UP", 92, 200),
      "Origin-API": leaf("UP", 93, 200), "Playstation-API": leaf("UP", 94, 200),
      "Xbox-API": leaf("UP", 95, 200),
    },
    otherPlatforms: {
      "Playstation-Network": { Status: "UP", QueryTimestamp: 1790607908 },
      "Xbox-Live": { Status: "UP", QueryTimestamp: 1790607908 },
    },
  }, over);
};

const groupOf = (n, key) => n.groups.find((g) => g.key === key);

describe("服务器状态 · 归一化", () => {
  test("六个分组按固定顺序出来，名字是中文", () => {
    const n = core.normalizeServers(servers());
    assert.deepEqual(n.groups.map((g) => g.key), [
      "Origin_login", "EA_novafusion", "EA_accounts", "ApexOauth_Crossplay",
      "Playstation-Network", "Xbox-Live",
    ]);
    assert.deepEqual(n.groups.map((g) => g.label), [
      "登录服务", "游戏核心", "EA 账号", "跨平台联机", "PlayStation 网络", "Xbox Live",
    ]);
  });

  test("全部正常时问题计数为 0，每行都是 UP", () => {
    const n = core.normalizeServers(servers());
    assert.equal(n.summary.problem, 0);
    assert.equal(n.summary.up, n.summary.total);
    n.groups.forEach((g) => assert.equal(g.status, "UP", g.key + " 应为 UP"));
  });

  test("按大区分的那四组，每个大区都要带上中文名", () => {
    const n = core.normalizeServers(servers());
    const login = groupOf(n, "Origin_login");
    assert.equal(login.regions.length, 7);
    assert.deepEqual(login.regions.map((r) => r.label), [
      "欧洲西部", "欧洲东部", "美西", "美中", "美东", "南美", "亚洲",
    ]);
  });

  test("某个大区故障：组的整体状态取最差的那个，并点名是哪个区", () => {
    const s = servers();
    s.EA_novafusion["Asia"] = leaf("DOWN", 999, 503);
    const n = core.normalizeServers(s);
    const g = groupOf(n, "EA_novafusion");
    assert.equal(g.status, "DOWN");
    assert.deepEqual(g.trouble.map((t) => t.label), ["亚洲"]);
    assert.equal(n.summary.down, 1);
    assert.equal(n.summary.problem, 1, "只有这一处异常");
  });

  test("SLOW 也算异常（只是没到故障）", () => {
    const s = servers();
    s.Origin_login["EU-West"] = leaf("SLOW", 3000, 200);
    const n = core.normalizeServers(s);
    const g = groupOf(n, "Origin_login");
    assert.equal(g.status, "SLOW");
    assert.equal(n.summary.slow, 1);
    assert.equal(n.summary.problem, 1);
  });

  test("故障比缓慢优先：一组里两者都有时按故障算", () => {
    const s = servers();
    s.EA_accounts["Asia"] = leaf("SLOW", 2000, 200);
    s.EA_accounts["EU-East"] = leaf("DOWN", 0, 503);
    const g = groupOf(core.normalizeServers(s), "EA_accounts");
    assert.equal(g.status, "DOWN");
    assert.deepEqual(g.trouble.map((t) => t.label), ["欧洲东部", "亚洲"]);
  });

  test("没见过的状态值要当成异常，绝不能当成正常（服务器挂了却满屏绿最糟）", () => {
    const s = servers();
    s.Origin_login["Asia"] = leaf("MAINTENANCE", null, null);
    const n = core.normalizeServers(s);
    const g = groupOf(n, "Origin_login");
    assert.equal(g.status, "UNKNOWN");
    assert.equal(n.summary.unknown, 1);
    assert.equal(n.summary.problem, 1, "未知状态必须计入异常");
    assert.notEqual(n.summary.problem, 0);
  });

  test("otherPlatforms 没有 ResponseTime，不能因此崩掉或编一个 0 出来", () => {
    const n = core.normalizeServers(servers());
    const psn = groupOf(n, "Playstation-Network");
    assert.ok(psn, "PlayStation 网络这一行要在");
    assert.equal(psn.ms, null, "没有响应时间就如实给 null");
    assert.equal(psn.status, "UP");
  });

  test("检查时延取该组里最慢的那个（要看最坏情况）", () => {
    const s = servers();
    s.EA_accounts["Asia"] = leaf("UP", 321, 200);
    assert.equal(groupOf(core.normalizeServers(s), "EA_accounts").ms, 321);
  });

  test("未知的大区名保留原文，不显示空白", () => {
    const s = servers();
    s.Origin_login["Mars"] = leaf("UP", 1, 200);
    const g = groupOf(core.normalizeServers(s), "Origin_login");
    assert.ok(g.regions.some((r) => r.label === "Mars"));
  });

  test("上游改了分组名要透出来（否则这一行会无声消失）", () => {
    const s = servers();
    s.Brand_New_Service = { "Asia": leaf("UP", 1, 200) };
    const n = core.normalizeServers(s);
    assert.deepEqual([...n.unknown], ["Brand_New_Service"]);
    assert.equal(n.groups.some((g) => g.key === "Brand_New_Service"), false, "不认识的组不猜它的含义");
  });

  test("缺了某一组就少一行，不补假数据", () => {
    const s = servers();
    delete s.EA_accounts;
    const n = core.normalizeServers(s);
    assert.equal(n.groups.some((g) => g.key === "EA_accounts"), false);
    assert.equal(n.groups.length, 5);
  });

  test("拿不到数据时返回 null（界面据此整块不显示）", () => {
    assert.equal(core.normalizeServers(null), null);
    assert.equal(core.normalizeServers(undefined), null);
    assert.equal(core.normalizeServers({}), null);
    assert.equal(core.normalizeServers([]), null);
    assert.equal(core.normalizeServers("nope"), null);
  });

  test("带上探测时间（QueryTimestamp 是秒，要转毫秒）", () => {
    const s = servers();
    s.Origin_login["Asia"].QueryTimestamp = 1790600000;   // 很旧的一条，不该被选中
    s.EA_accounts["Asia"].QueryTimestamp = 1790607905;
    // fixture 里 otherPlatforms 是 1790607908，这才是最新的一条
    const n = core.normalizeServers(s);
    assert.equal(n.queriedAt, 1790607908 * 1000, "取最新的一次探测时间，不是最旧的");
  });

  test("没有探测时间时是 null，不编一个「现在」出来", () => {
    const s = servers();
    ["Origin_login", "EA_novafusion", "EA_accounts", "ApexOauth_Crossplay"].forEach((g) => {
      Object.keys(s[g]).forEach((k) => delete s[g][k].QueryTimestamp);
    });
    s.otherPlatforms["Xbox-Live"] = { Status: "UP" };
    s.otherPlatforms["Playstation-Network"] = { Status: "UP" };
    assert.equal(core.normalizeServers(s).queriedAt, null);
  });
});

describe("服务器状态 · 界面字段", () => {
  test("全部正常：一句「全部正常」而不是一片空白", () => {
    const v = vm.buildServers(core.normalizeServers(servers()));
    assert.equal(v.tone, "ok");
    assert.equal(v.summaryText, "全部正常");
    assert.equal(v.groups.length, 6);
    v.groups.forEach((g) => {
      assert.equal(g.statusText, "正常");
      assert.equal(g.tone, "ok");
      assert.equal(g.detailText, "", "正常时不该写异常明细");
    });
  });

  test("有异常时总览报数量，并把有问题的那行顶上来", () => {
    const s = servers();
    s.EA_novafusion["Asia"] = leaf("DOWN", 0, 503);
    s.Origin_login["EU-West"] = leaf("SLOW", 3000, 200);
    const v = vm.buildServers(core.normalizeServers(s));
    assert.equal(v.summaryText, "有 2 项异常");
    assert.notEqual(v.tone, "ok");
    assert.equal(v.groups[0].key, "EA_novafusion", "故障的排最前面");
    assert.equal(v.groups[1].key, "Origin_login", "其次是有缓慢的");
  });

  test("每行的状态文字分得清「缓慢」和「故障」和「未知」", () => {
    const s = servers();
    s.Origin_login["Asia"] = leaf("SLOW", 900, 200);
    s.EA_novafusion["Asia"] = leaf("DOWN", 0, 503);
    s.EA_accounts["Asia"] = leaf("WEIRD", 1, 200);
    const v = vm.buildServers(core.normalizeServers(s));
    const by = (k) => v.groups.find((g) => g.key === k);
    assert.equal(by("Origin_login").statusText, "缓慢");
    assert.equal(by("Origin_login").tone, "warn");
    assert.equal(by("EA_novafusion").statusText, "故障");
    assert.equal(by("EA_novafusion").tone, "bad");
    assert.equal(by("EA_accounts").statusText, "未知");
    assert.notEqual(by("EA_accounts").tone, "ok", "未知不能显示成正常");
  });

  test("异常明细点名到具体大区，人才能判断是不是自己这边", () => {
    const s = servers();
    s.Origin_login["Asia"] = leaf("DOWN", 0, 503);
    const v = vm.buildServers(core.normalizeServers(s));
    const g = v.groups.find((x) => x.key === "Origin_login");
    assert.ok(g.detailText.includes("亚洲"), "实际：" + g.detailText);
  });

  test("响应时间带上单位，且取该组最慢的那个；没有的就不显示", () => {
    const v = vm.buildServers(core.normalizeServers(servers()));
    // Origin_login 各区是 40/60/4/5/6/7/8，最慢 60
    assert.equal(v.groups.find((g) => g.key === "Origin_login").msText, "最慢 60 ms");
    assert.equal(v.groups.find((g) => g.key === "Playstation-Network").msText, "");
  });

  test("上游出现没见过的分组时，在界面上留一句提示", () => {
    const s = servers();
    s.Brand_New_Service = { "Asia": leaf("UP", 1, 200) };
    const v = vm.buildServers(core.normalizeServers(s));
    assert.equal(v.unknownText, "Brand_New_Service");
  });

  test("拿不到数据时返回 null，整块不渲染", () => {
    assert.equal(vm.buildServers(null), null);
    assert.equal(vm.buildServers({}), null);
  });
});
