// 诊断：先剥注释、再找写死的 6 位色值（区分"代码里的"和"只出现在注释里的"）。
// 用法：node tools/scan-hardcoded-colors.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "..", "miniprogram", "app.wxss");
const WXSS = readFileSync(FILE, "utf8");

const lightIdx = WXSS.indexOf(".wrap.theme-light {");
// 和 theme.test.mjs 一样，先砍掉深色变量块与浅色块
const rules = WXSS.slice(0, lightIdx) + WXSS.slice(lightIdx + 1500);
// 再砍掉变量声明
const noVars = rules.replace(/--[a-z0-9-]+\s*:\s*[^;]+;/g, "");
// 【关键】再砍掉注释 —— 官方测试缺的就是这一步
const noComments = noVars.replace(/\/\*[\s\S]*?\*\//g, "");

const grab = (s) => [...new Set([...s.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];

const withComments = grab(noVars).filter((c) => c !== "#ffffff");
const withoutComments = grab(noComments).filter((c) => c !== "#ffffff");

console.log("剥注释【前】发现的写死色值（官方测试当前的判定）:");
console.log("  " + (withComments.join(", ") || "(无)"));
console.log("");
console.log("剥注释【后】发现的写死色值（真正在代码里的）:");
if (!withoutComments.length) console.log("  (无) ✅");
for (const c of withoutComments) {
  const lines = noComments.split("\n");
  lines.forEach((l, i) => {
    if (l.toLowerCase().includes(c)) console.log("  " + c + "  ->  行内: " + l.trim());
  });
}
