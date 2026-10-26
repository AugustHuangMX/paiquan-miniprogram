/**
 * 图标渲染用的小服务。
 *
 * 为什么要它：浏览器里能用 canvas 把 SVG 渲染成任意尺寸的 PNG（比任何图像库都准），
 * 但浏览器不能写文件。所以开了这个只监听本机的小服务，页面上点一下就把 PNG 落到 assets/。
 *
 * 用法： node tools/icon-server.mjs
 * 然后打开它打印的地址，改 tools/icon.html 里的图标，点导出。
 */
import http from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ASSETS = path.join(ROOT, "assets");
const PORT = Number(process.env.PORT || 8790);

// 只允许写这几类名字，别的都拒掉 —— 别让它变成任意写文件的入口
const ALLOWED = /^(icon|tab-[a-z]+)(-\d+|-on)?\.(png|svg)$/;

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/save") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!ALLOWED.test(body.name || "")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "文件名不允许：" + body.name }));
        return;
      }
      await mkdir(ASSETS, { recursive: true });
      let buf;
      if (body.text != null) buf = Buffer.from(String(body.text), "utf8");
      else buf = Buffer.from(String(body.dataURL).replace(/^data:image\/png;base64,/, ""), "base64");

      await writeFile(path.join(ASSETS, body.name), buf);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: buf.length, file: "assets/" + body.name }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  if (req.method === "GET") {
    const name = req.url === "/" ? "icon.html" : req.url.replace(/^\/+/, "").split("?")[0];
    if (!/^[\w.-]+\.html$/.test(name)) { res.writeHead(400); res.end("bad name"); return; }
    try {
      const html = await readFile(path.join(HERE, name));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch (e) {
      res.writeHead(404);
      res.end("not found: " + name);
      return;
    }
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("图标渲染页: http://127.0.0.1:" + PORT + "/");
  console.log("导出的 PNG 会写进: " + ASSETS);
});
