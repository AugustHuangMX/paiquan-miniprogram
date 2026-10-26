// 一次性修正：上一步用「color: var(--accent)」做全局替换时，
// 正则的 \s* 把「border-color: ...」也一起命中了，于是 7 处边框被误换成
// --accent-ink。边框属于「填充」语义，应回到 --accent。
// 用法：node tools/fix-accent-border.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(HERE, "..", "miniprogram", "app.wxss");
const src = readFileSync(file, "utf8");

const before = (src.match(/border-color:\s*var\(--accent-ink\)/g) || []).length;
const out = src.replace(/border-color:(\s*)var\(--accent-ink\)/g, "border-color:$1var(--accent)");
const after = (out.match(/border-color:\s*var\(--accent-ink\)/g) || []).length;

writeFileSync(file, out, "utf8");

console.log("border-color 误改处数:", before, "-> 剩余:", after);
console.log("文件字节数:", src.length, "->", out.length);
// 顺手核对中文注释没有被上一次的 Set-Content 弄坏
const cjk = (out.match(/[\u4e00-\u9fff]/g) || []).length;
console.log("文中中文字符数:", cjk, cjk > 2000 ? "✅ 注释完好" : "❌ 可能有编码损坏");
