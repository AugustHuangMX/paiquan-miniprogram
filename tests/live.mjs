// 联机校验：把云函数 handler 当成真代码，用真 Key 打真的上游。
//
// 这是我在这个环境里能对"云函数这一层"做的最强验证 —— 小程序界面本身要靠
// 微信开发者工具（GUI）才能跑，但云函数是纯 Node 代码，可以真跑。
//
// 跑法：  $env:APEX_API_KEY="你的key"; node tests/live.mjs
// 不带 Key 时只跑不需要 Key 的检查（缺 Key 提示、参数校验），其余跳过。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { handle } = require(path.resolve(HERE, "..", "cloudfunctions", "apex", "handler.js"));
const core = require(path.resolve(HERE, "..", "miniprogram", "utils", "core.js"));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ok   " + m); };
const bad = (m, d) => { fail++; console.log("  FAIL " + m + "\n       " + d); };
const info = (m) => console.log("  info " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = (process.env.APEX_API_KEY || "").trim();
console.log("云函数联机校验" + (KEY ? "（带真 Key）" : "（无 Key，只跑不需 Key 的检查）") + "\n");

/* ---- 1. 不需要 Key 的路径 ---- */
{
  const r = await handle({ action: "rotation" }, { apiKey: "" });
  if (r.ok === false && r.kind === "nokey" && /ALS_API_KEY/.test(r.message)) ok("未配 Key → nokey，且提示里点名环境变量");
  else bad("未配 Key 的处理不对", JSON.stringify(r));
}
{
  const r = await handle({ action: "nonsense" }, { apiKey: "x" });
  if (!r.ok && r.kind === "action") ok("非法 action → action");
  else bad("非法 action 处理不对", JSON.stringify(r));
}
{
  let called = 0;
  const r = await handle({ action: "player", player: "  " }, { apiKey: "x", fetchImpl: async () => { called++; throw new Error("不该被调用"); } });
  if (!r.ok && r.kind === "badparam" && called === 0) ok("空玩家名 → badparam，且不浪费上游配额");
  else bad("空玩家名处理不对", JSON.stringify(r) + " called=" + called);
}

if (!KEY) {
  console.log("\n  skip 真实数据校验（未设置 APEX_API_KEY）");
  console.log("\n结果：" + pass + " 通过, " + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
}

/* ---- 2. 真的打上游 ---- */
const deps = { apiKey: KEY, now: () => Date.now() };

let rot = await handle({ action: "rotation" }, deps);
if (!rot.ok) {
  if (rot.kind === "unverified") {
    bad("Key 未激活", "去 https://portal.apexlegendsapi.com/discord-auth 绑定 Discord 后重跑。");
  } else {
    bad("拉取地图轮换失败", "kind=" + rot.kind + " message=" + rot.message);
  }
} else {
  const modes = rot.data.modes;
  const list = [...modes].map((m) => m.def.id + "=" + (m.current ? m.current.map : "(未开启)"));
  console.log("\n  实际拿到的四个模式：");
  list.forEach((l) => console.log("    " + l));

  const ALWAYS_ON = ["ranked", "pubs", "mixtape"];
  const missing = ALWAYS_ON.filter((id) => !modes.find((m) => m.def.id === id).current);
  if (missing.length === 0) ok("排位/匹配/轮换三张图有真实数据");
  else bad("有模式取不到地图", "缺失：" + missing.join(", "));

  const wc = modes.find((m) => m.def.id === "wildcard");
  if (wc.current) ok("外卡模式地图：" + wc.current.map);
  else info("外卡模式当前未开启（上游不返回 wildcard 键，官网对应区块也是空的），属正常");

  const mix = modes.find((m) => m.def.id === "mixtape");
  if (mix.current && mix.current.eventName) ok("轮换模式玩法：" + mix.current.eventName);
  else info("轮换模式这次没带 eventName");

  if (rot.data.unknownKeys.length === 0) ok("没有出现未识别的模式字段（说明字段名没变）");
  else bad("出现了未识别的模式字段", JSON.stringify(rot.data.unknownKeys) + " —— 需要更新 core.js 的候选键");

  // 缓存：紧接着再调一次，不该再打上游
  const again = await handle({ action: "rotation" }, deps);
  if (again.ok && again.cached) ok("30 秒内重复请求命中缓存（省上游配额与出网流量）");
  else bad("缓存没生效", JSON.stringify({ ok: again.ok, cached: again.cached }));
}

await sleep(2500);
const srv = await handle({ action: "servers" }, deps);
if (!srv.ok) {
  bad("拉取服务器状态失败", "kind=" + srv.kind + " message=" + srv.message);
} else if (!srv.data.servers) {
  bad("服务器状态没归一化出内容", JSON.stringify(srv.data));
} else {
  const s = srv.data.servers;
  ok("服务器状态：" + s.summary.total + " 个分组，异常 " + s.summary.problem + " 项");
  [...s.groups].forEach((g) => {
    const trouble = g.trouble.length ? " ← 异常：" + [...g.trouble].map((t) => t.label).join("、") : "";
    console.log("       " + g.label + " = " + g.status + (g.ms == null ? "" : " (" + g.ms + "ms)") + trouble);
  });
  // 分组名必须都翻译成了中文，否则界面上会露出 Origin_login 这种内部代号
  const rawNames = s.groups.filter((g) => /^[A-Za-z_-]+$/.test(g.label));
  if (rawNames.length) bad("有分组名没翻译成中文", JSON.stringify(rawNames.map((g) => g.label)));
  else ok("分组名都翻译成了中文");
  if (s.unknown.length) info("上游出现了没见过的分组：" + s.unknown.join("、") + "（界面会提示，需要人工确认含义）");
}

await sleep(2500);
const pred = await handle({ action: "predator" }, deps);
if (!pred.ok) {
  bad("拉取猎杀分数线失败", "kind=" + pred.kind + " message=" + pred.message);
} else {
  const plats = pred.data.group ? pred.data.group.plats : [];
  if (plats.length === 4) {
    ok("猎杀分数线：" + [...plats].map((p) => p.code + " " + p.rp).join(" / "));
    console.log("       猎杀人数：" + [...plats].map((p) => p.code + " " + (p.predCount == null ? "—" : p.predCount)).join(" / "));
    console.log("       大师+猎杀：" + [...plats].map((p) => p.code + " " + p.masters).join(" / "));

    // 上游的刷新时间（界面上要显示"这份数据是什么时候的"）
    const withTime = plats.filter((p) => typeof p.updatedAt === "number" && p.updatedAt > 0);
    if (withTime.length === plats.length) {
      const ages = withTime.map((p) => Math.round((Date.now() - p.updatedAt) / 60000));
      ok("上游刷新时间都读出来了（分钟前）：" + ages.join(" / "));
      if (ages.some((m) => m < -5)) bad("有平台的刷新时间落在未来，时间单位可能解析错了");
    } else {
      bad("有平台没解析出刷新时间", JSON.stringify(plats.map((p) => p.code + "=" + p.updatedAt)));
    }

    // 命令行跑的时候没有注入 store，不该凭空出现涨幅
    const withDelta = plats.filter((p) => p.delta !== undefined && p.delta !== null);
    if (withDelta.length === 0) info("没有 store 时没有涨幅字段 —— 符合预期（网页版就是这样）");
    else bad("没注入 store 却出现了涨幅", JSON.stringify(withDelta));
  } else {
    bad("猎杀分数线平台数不对", "拿到 " + plats.length + " 个：" + JSON.stringify(pred.data.group));
  }
}

await sleep(2500);
let player = await handle({ action: "player", player: "shroud", platform: "PC" }, deps);
if (!player.ok) {
  bad("查玩家失败", "kind=" + player.kind + " message=" + player.message);
} else {
  const p = player.data.player;
  ok("玩家查询：" + p.name + " 等级 " + p.level + " 段位 " + (p.rankName || "无") + " RP " + p.rankScore + " 名次 " + (p.ladderPos == null ? "未进榜" : "#" + p.ladderPos));
  if (p.ladderPos === -1) bad("名次没被归一化", "-1 应当已经在归一化层转成 null");

  // 战绩页新增的字段也要用真实数据核对一遍
  if (p.realtime) ok("在线状态：" + p.realtime.stateText + " · 当前传奇 " + (p.realtime.legend || "无"));
  else bad("realtime 没解析出来", "战绩页要靠它显示在线状态");

  if (p.banned && typeof p.banned.active === "boolean") {
    ok("封禁状态读出来了：active=" + p.banned.active);
  } else {
    bad("banned 字段缺失或类型不对", JSON.stringify(p.banned));
  }

  if (p.highlights && p.highlights.length) {
    console.log("       生涯数据（真实拿到 " + p.highlights.length + " 条）：");
    [...p.highlights].forEach((h) => console.log("         " + h.label + " = " + h.valueText));
    const noSep = p.highlights.filter((h) => h.value >= 1000 && !/,/.test(h.valueText));
    if (noSep.length) bad("有数值没加千分位", JSON.stringify(noSep.map((h) => h.valueText)));
    else ok("生涯数值都带了千分位");
  } else {
    info("这个玩家没有可显示的生涯数据（追踪器是玩家自己在游戏里挂的，属正常）");
  }
}

await sleep(2000);
const nobody = await handle({ action: "player", player: "zzzz_not_a_real_player_zzzz", platform: "PC" }, deps);
if (!nobody.ok && (nobody.kind === "notfound" || nobody.kind === "http")) {
  ok("不存在的玩家 → " + nobody.kind + "（不会假装查到）");
} else if (nobody.ok) {
  info("上游居然返回了这个不存在的玩家，跳过此项");
} else {
  bad("查不到玩家时的分类意外", JSON.stringify(nobody));
}

console.log("\n结果：" + pass + " 通过, " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
