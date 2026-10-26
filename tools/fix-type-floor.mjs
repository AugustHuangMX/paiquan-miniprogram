// 把所有低于 24rpx 的字号统一提到 24rpx —— 微信官方最小档是 12pt（=24rpx），
// 比它小的正文既违反适老化指南，也正是"看着累"的主因。
//
// 为什么用脚本而不是手工改：这类声明有 20+ 处，分散在三个页面共用的 app.wxss 里，
// 漏一处就留下一个"文档说改了、实际没改"的坑。
//
// ⚠️ 必须用 node 读写（显式 utf8）。Windows PowerShell 5.1 的 Set-Content
//    默认按 GBK 落盘，会把中文注释整片弄坏（本轮已经踩过一次，从备份恢复了）。
//
// 用法：node tools/fix-type-floor.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "..", "miniprogram", "app.wxss");
const apply = process.argv.includes("--apply");
const FLOOR = 24;

const src = readFileSync(FILE, "utf8");
const hits = [];

const out = src.replace(/font-size:\s*([\d.]+)rpx/g, (m, v) => {
  const n = parseFloat(v);
  if (n >= FLOOR) return m;
  hits.push(n);
  return "font-size: " + FLOOR + "rpx";
});

console.log("低于 " + FLOOR + "rpx 的字号声明：" + hits.length + " 处");
const counts = {};
for (const n of hits) counts[n] = (counts[n] || 0) + 1;
for (const k of Object.keys(counts).sort((a, b) => a - b)) {
  console.log("  " + k + "rpx × " + counts[k]);
}

if (!apply) {
  console.log("\n（预览模式，未写盘。加 --apply 才真的改。）");
} else {
  writeFileSync(FILE, out, "utf8");
  console.log("\n已写入 " + FILE + "（utf8），" + src.length + " -> " + out.length + " 字节");
}

// 自检：改完之后还有没有低于下限的
const left = (out.match(/font-size:\s*(1\d|2[0-3])rpx/g) || []).length;
console.log("剩余低于下限的字号：" + left + (left === 0 ? " ✅" : " ❌"));
const cjk = (out.match(/[\u4e00-\u9fff]/g) || []).length;
console.log("中文字符数：" + cjk + (cjk > 3000 ? " ✅ 注释完好" : " ❌ 可能损坏"));
