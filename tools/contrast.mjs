// 对比度核验：把所有关键前景/背景组合按 WCAG 相对亮度算一遍。
// 阈值：正文（<18pt）≥4.5:1，大字（≥18pt / 24px）≥3:1。
// 用法：node tools/contrast.mjs
const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (h) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// 深色主题
const dark = { bg: "#0a0c10", surface: "#141821", sunken: "#0f131a", rim: "#252c38",
  ink: "#eef1f6", ink2: "#9aa4b4", ink3: "#8b95a6",
  accent: "#d92b2b",      // 填充用：白字压在上面
  accentInk: "#ff5a52",   // 文字用：画在深色底上
  up: "#3ddc84" };
// 浅色主题
const light = { bg: "#f5f6f8", surface: "#ffffff", sunken: "#eceef2", rim: "#e2e5eb",
  raised: "#eef1f5",      // 卡中卡 / 轮盘的另一种扇形底
  ink: "#171a20", ink2: "#545f6e", ink3: "#5f6a79",
  accent: "#d92b2b",      // 白字压在上面 4.84:1
  accentInk: "#c62828",   // 当文字用，白底上更深
  up: "#0e7c43" };

const checks = [
  ["深 · 主文字 on 页面底", dark.ink, dark.bg, 4.5],
  ["深 · 主文字 on 卡片", dark.ink, dark.surface, 4.5],
  ["深 · 次文字 on 卡片", dark.ink2, dark.surface, 4.5],
  ["深 · 弱文字 on 卡片", dark.ink3, dark.surface, 4.5],
  ["深 · 弱文字 on 次级面", dark.ink3, dark.rim, 4.5],
  ["深 · 强调红 on 卡片", dark.accent, dark.surface, 4.5],
  ["深 · 强调红 on 页面底", dark.accent, dark.bg, 4.5],
  ["深 · 强调红字 on 卡片（文字用）", dark.accentInk, dark.surface, 4.5],
  ["深 · 强调红字 on 页面底", dark.accentInk, dark.bg, 4.5],
  ["深 · 强调红字 on 次级面", dark.accentInk, dark.rim, 4.5],
  ["深 · 白字 on 强调红（主按钮）", "#ffffff", dark.accent, 4.5],
  ["深 · 白字 on 强调红（大字）", "#ffffff", dark.accent, 3.0],
  ["浅 · 主文字 on 页面底", light.ink, light.bg, 4.5],
  ["浅 · 主文字 on 卡片", light.ink, light.surface, 4.5],
  ["浅 · 次文字 on 卡片", light.ink2, light.surface, 4.5],
  ["浅 · 弱文字 on 卡片", light.ink3, light.surface, 4.5],
  ["浅 · 弱文字 on 页面底", light.ink3, light.bg, 4.5],
  ["浅 · 弱文字 on 次级面", light.ink3, light.sunken, 4.5],
  ["浅 · 强调红 on 卡片", light.accent, light.surface, 4.5],
  ["浅 · 强调红 on 页面底", light.accent, light.bg, 4.5],
  ["浅 · 强调红字 on 卡片（文字用）", light.accentInk, light.surface, 4.5],
  ["浅 · 强调红字 on 页面底", light.accentInk, light.bg, 4.5],
  ["浅 · 白字 on 强调红（主按钮）", "#ffffff", light.accent, 4.5],
  ["浅 · 白字 on 强调红字（文字色当底，反例）", "#ffffff", light.accentInk, 4.5],
  ["浅 · 绿 on 卡片", light.up, light.surface, 4.5],
  ["浅 · 绿旧值 #0f8a4a on 卡片（对照）", "#0f8a4a", light.surface, 4.5],
  ["浅 · 深色绿旧值 on 卡片（对照）", "#3ddc84", light.surface, 4.5],
  // —— 轮盘（2026-10 新增）——
  // 盘面上的名字压在两种扇形底上；中奖那一片是实心强调红 + 白字。
  // 这两条底色的对比度必须各自成立，否则有一半名字在某个主题下看不清。
  ["深 · 轮盘字 on 深扇形（card）", dark.ink, dark.surface, 4.5],
  ["深 · 轮盘字 on 亮扇形（raised）", dark.ink, dark.rim, 4.5],
  ["深 · 轮盘中奖白字 on 强调红", "#ffffff", dark.accent, 4.5],
  ["浅 · 轮盘字 on 深扇形（card）", light.ink, light.surface, 4.5],
  ["浅 · 轮盘字 on 亮扇形（raised）", light.ink, light.raised, 4.5],
  ["浅 · 轮盘中奖白字 on 强调红", "#ffffff", light.accent, 4.5],
];

let fails = 0;
console.log("组合".padEnd(40) + "比值".padStart(8) + "  阈值  判定");
console.log("-".repeat(70));
for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(label.padEnd(40) + r.toFixed(2).padStart(8) + "  " + min.toFixed(1) + "   " + (ok ? "✅" : "❌ 不达标"));
}
console.log("-".repeat(70));
console.log(fails === 0 ? "全部达标 ✅" : fails + " 项不达标 ❌");
process.exitCode = fails === 0 ? 0 : 1;
