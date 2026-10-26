/**
 * 给 WXML 预览器生成的 HTML 截图（preview.mjs 只负责拼 HTML，截图在这一步）。
 *
 * 为什么要单独一个脚本：微信开发者工具是 GUI，这个环境里跑不了；
 * 改 UI 想"看见"就只能自己拼 HTML + 自己截图。preview.mjs 已经把真实
 * WXML/WXSS/data 拼好了，这里只做最后一步。
 *
 * 用法：
 *   node tools/shot.mjs <preview.html> <out.png> [宽度] [起始选择器] [裁切高度] [viewport]
 *   例：node tools/shot.mjs out/preview_predator.html out/predator.png
 *       node tools/shot.mjs out/preview_predator.html out/algs.png 390 ".algs-head" 2400
 *       node tools/shot.mjs out/preview_matches.html out/sheet.png 390 ".nx-sheet" 0 viewport
 *
 * 说明：
 *   · 用 DSH profile 里自带的 playwright-core（不额外装东西）；
 *   · 逐个尝试几种启动方式 —— 这台机器上浏览器启动方式比较挑；
 *   · 默认 390px 宽（iPhone 12/13），和 preview.mjs 里的 WIDTH 对齐；
 *   · 给了选择器就只截那一段（整页 8000+px 太长，看某一节还是裁出来清楚）；
 *   · 默认全页截图；第 7 个参数写 viewport 就只截视口（**固定定位的弹层必须用它**：
 *     fullPage 会把视口拉到整页高，fixed 元素会被顶到页面最底部，截出来看不到）。
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PLAYWRIGHT = "C:/Users/Lenovo/.dsh/profiles/web/node_modules/playwright-core";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const htmlPath = process.argv[2];
const outPath = process.argv[3] || path.join(HERE, "..", "preview", "shot.png");
const width = Number(process.argv[4] || 390);
const startSel = process.argv[5] || "";
const clipH = Number(process.argv[6] || 0);
const mode = (process.argv[7] || "").toLowerCase();

if (!htmlPath) {
  console.error("用法：node tools/shot.mjs <preview.html> <out.png> [宽度] [起始选择器] [裁切高度]");
  process.exit(2);
}

const fileUrl = "file:///" + path.resolve(htmlPath).split(path.sep).join("/");

async function shoot(label, opts) {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch(Object.assign({ headless: true }, opts));
  try {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,            // 2 倍图，看细节（rpx 换算后都是小数像素）
    });
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.waitForTimeout(600);    // 等图片解码，否则截图里会有空白块

    let clip = null;
    if (startSel && mode !== "viewport") {
      const el = await page.$(startSel);
      if (!el) throw new Error("找不到选择器 " + startSel);
      const box = await el.boundingBox();
      const total = await page.evaluate(() => document.body.scrollHeight);
      const top = Math.max(0, box.y - 56);          // 往上多留一点，别把标题切掉
      clip = {
        x: 0, y: top, width,
        height: clipH > 0 ? Math.min(clipH, total - top) : (total - top),
      };
    }
    // ⚠️ 裁切必须和 fullPage 一起用：不给 fullPage 时 clip 是**视口内**的坐标，
    //    而这里要裁的 y 常常在几千像素外，会直接报 "Clipped area is either
    //    empty or outside the resulting image"（第一次就是这么失败的）。
    //    viewport 模式相反：不 fullPage、不裁切，固定定位的弹层才截得到。
    if (mode === "viewport") {
      await page.screenshot({ path: outPath });
    } else {
      await page.screenshot(Object.assign({ path: outPath, fullPage: true },
        clip ? { clip } : {}));
    }
    const h = await page.evaluate(() => document.body.scrollHeight);
    return h;
  } finally {
    await browser.close();
  }
}

const attempts = [
  ["系统 Edge · channel", { channel: "msedge" }],
  ["系统 Edge · executablePath", { executablePath: EDGE }],
  ["系统 Edge · 兼容参数", { executablePath: EDGE, args: ["--disable-gpu", "--no-sandbox"] }],
];

for (const [label, opts] of attempts) {
  try {
    const h = await shoot(label, opts);
    const kb = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`✔ ${label} 成功：${outPath}（${kb} KB，页面高 ${h}px）`);
    process.exit(0);
  } catch (err) {
    console.log(`✖ ${label} 失败：${String(err.message || err).split("\n")[0]}`);
  }
}
console.error("全部启动方式都失败 —— 浏览器起不来，截图跳过（不影响代码正确性）");
process.exit(1);
