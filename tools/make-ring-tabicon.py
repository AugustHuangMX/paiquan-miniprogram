# -*- coding: utf-8 -*-
"""
生成「猜圈」这个 tab 的图标（assets/tab-ring.png / tab-ring-on.png）。

为什么要自己画：底部 tab 原来四项（地图 / 排位专区 / 比赛 / 战绩），
2026-10-16 用户要求把第 4 项「战绩」换成「猜圈」小游戏。
微信的 tabBar 图标必须是**图片文件**，不能是字体图标或 SVG，
所以只能生成两张 PNG（未选中 + 选中）。

规格照抄现有那几张（用 Pillow 量出来的）：
    81 x 81、RGBA、**单一纯色**、透明背景
    未选中 rgb(143,151,165)   选中 rgb(224,53,58)

图形用「同心圆 + 圆心点」，一眼就是"圈"：
    外圈 r=30 / 中圈 r=20 / 内圈 r=10 / 圆心点 r=3
    （4 倍超采样再缩到 81，边缘才不毛）

用法：
    python tools/make-ring-tabicon.py --out 直播识别/out/tabicon
然后由人（或一条提权命令）把两张 PNG 拷进 miniprogram/assets/。
"""

import argparse
import os
import sys

from PIL import Image, ImageDraw

SIZE = 81
SS = 4                      # 超采样倍数
COLOR_OFF = (143, 151, 165, 255)
COLOR_ON = (224, 53, 58, 255)

# (半径, 线宽)：外、中、内三圈 + 圆心点（线宽 0 = 实心）
RINGS = [(30, 5), (20, 4), (10, 4), (3, 0)]


def draw_icon(color):
    n = SIZE * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (n - 1) / 2.0
    for r, w in RINGS:
        box = [c - r * SS, c - r * SS, c + r * SS, c + r * SS]
        if w == 0:
            d.ellipse(box, fill=color)
        else:
            d.ellipse(box, outline=color, width=int(round(w * SS)))
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    # ★ 缩放会把 RGB 和透明背景混在一起，得到一个渐变色带（实测 111 种颜色）。
    #   现有那几张 tab 图标都是**单一纯色 + alpha 抗锯齿**，所以这里把 RGB 统一回纯色，
    #   只让 alpha 承担抗锯齿 —— 这样风格才一致。
    px = im.load()
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (color[0], color[1], color[2], a)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "直播识别", "out", "tabicon"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, color in [("tab-ring.png", COLOR_OFF), ("tab-ring-on.png", COLOR_ON)]:
        p = os.path.join(args.out, name)
        draw_icon(color).save(p, "PNG", optimize=True)
        # 自检：81x81、不透明像素只有一种颜色、有半透明边缘（= 抗锯齿）
        im = Image.open(p).convert("RGBA")
        data = list(im.getdata())
        cols = set(px[:3] for px in data if px[3] > 128)
        soft = sum(1 for px in data if 0 < px[3] <= 128)
        ok = im.size == (SIZE, SIZE) and len(cols) == 1 and soft > 0
        print("%-16s %s 不透明色 %d 种 %s 半透明边缘 %d 像素  %.1f KB  %s" % (
            name, im.size, len(cols), sorted(cols), soft, os.path.getsize(p) / 1024.0,
            "OK" if ok else "★ 不符合现有图标规格"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
