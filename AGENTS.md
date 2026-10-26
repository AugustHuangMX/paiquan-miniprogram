# AGENTS.md · 给接手这个仓库的 AI 读的第一份文件

> 这是一个**已上线**的微信小程序：Apex 英雄「地图 & 猎杀榜」查询工具。
> 给人看的交接说明在 `START-HERE.md` / `AI-CONTEXT.md`；本文件是**动手前必须遵守的硬规则**。

## 先读什么（按顺序）

1. `AI-CONTEXT.md` —— 架构、云端 action 总表、约定、20 条红线、已知坑。**必读。**
2. `PRODUCT.md` —— 产品事实与不可编造的数据口径。
3. `FILE-INDEX.md` —— 每个文件干什么（含哪些文档已过时）。

## 常用命令

```bash
node tests/core.test.mjs      # 单个测试文件（推荐这样跑）
node tests/static.test.mjs    # 隐私接口黑名单 / 存储白名单 / WXML 一致性
node tests/page.test.mjs      # 七个页面的行为
# 全量：逐个跑 tests/*.test.mjs（30 个文件，约 1 分钟）
```

**不要用 `node --test tests/`** —— 运行器会 spawn 子进程并用管道收输出，在受控环境里报 `EPERM`。断言完全一样，单个文件跑即可。

## 八条红线（违反就会坏）

1. `miniprogram/utils/core.js` 与 `cloudfunctions/apex/core.js` **必须字节一致**，改一份原样复制另一份（`tests/sync.test.mjs` 会拦）。
2. 小程序端**不许**出现 API Key、32 位十六进制串、外部域名（境外域名没备案，微信直接拦）。
3. 云函数只能用 Node 内置模块 + `wx-server-sdk`；**不能用全局 `fetch`**（运行时是 Node 16）。
4. 云函数的任何数据库/上游错误都要降级成"没有这项数据"，不许把异常抛给前端。
5. 只有 `miniprogram/utils/prefs.js` 能碰本地存储，且只存界面偏好（白名单键见 `AI-CONTEXT.md` §9）。
6. 颜色只走 CSS 变量；字号不小于 `24rpx`；浅色主题必须覆盖深色的每一个变量。
7. WXML 不写死中文，文案走 `{{T.xxx}}`，中英词表必须成对。
8. **不编数据**：取不到就留空 / 显示英文原值 / 整块隐藏，不许给 0、空数组或占位文案。

## 提交与分支

- 分支：`main` 是可用基线；改动走 `feat/xxx`、`fix/xxx`、`ui/xxx`，改完合回 `main`。
- 提交信息写**为什么**，不只写改了什么。格式示例（照这个写）：
  `feat(maps): 轮换卡片加「距轮换」小标题`、`fix(predator): 涨幅窗口从 18h 放到 20h`。
- 提交前必须：跑相关测试 → 全绿 → 再提交。

## 不要做

- **不要 `git init`**：`apex-miniapp` 已有仓库（`main` 分支）。
  你若只拿到 zip，请先 clone 仓库再把文件覆盖进去；已经 init 过的，删掉那份 `.git`（`rm -rf .git`）再 clone。
  两个各自 init 的仓库没有共同祖先，将来合不了。
- 不要提交 `project.private.config.json`（已在 `.gitignore`，是本机私有配置）。
- 不要在共享代码里改 `appid` / `CLOUD_ENV` 来跑自己的环境；那是本机差异，见 `AI-CONTEXT.md` §15。
- 不要把 `preview/`、`out_*.html`、`node_modules/` 提交进来（已 ignore，别强行 `-f`）。
- 不要在没有测试覆盖的情况下改 `utils/core.js`、`utils/viewmodel.js`、`cloudfunctions/apex/handler.js`。
