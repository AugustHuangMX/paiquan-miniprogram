# -*- coding: utf-8 -*-
"""生成首页（2026-10-27 改版）用到的两组位图：

  assets/tab-home.png / tab-home-on.png   「首页」tab 图标（81x81，和现有图标同一套颜色与实心风格）
  assets/logo-mark.png                     首页导航栏左边的派圈图标（128x128，从 tools/brand/paiquan-logo.png 裁出来）

颜色：tab 图标未选中 #8f97a5、选中 #e0353a（从现有 tab 图标采的，同 make-games-tabicon.py）。
用法：python tools/make-home-assets.py（在仓库根目录跑）
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 4                 # 超采样倍数：直接画小图边缘会有锯齿，画 4 倍再 LANCZOS 缩下来
GRAY = (143, 151, 165, 255)
RED = (224, 53, 58, 255)
CLEAR = (0, 0, 0, 0)
ASSETS = Path(__file__).resolve().parent.parent / "miniprogram" / "assets"
BRAND = Path(__file__).resolve().parent / "brand" / "paiquan-logo.png"   # 派圈的图标原图（2048x2048，2026-10-27 用户给的）


def house(color):
    """实心小房子：屋顶 + 屋身，门挖成透明（读起来才是房子而不是一块五边形）"""
    n = 81 * S
    im = Image.new("RGBA", (n, n), CLEAR)
    d = ImageDraw.Draw(im)

    def sc(v):
        return int(round(v * S))

    d.polygon([(sc(40.5), sc(8)), (sc(75), sc(38)), (sc(6), sc(38))], fill=color)   # 屋顶
    d.rounded_rectangle([sc(15), sc(32), sc(66), sc(73)], radius=sc(6), fill=color)  # 屋身
    d.rounded_rectangle([sc(33), sc(50), sc(48), sc(73)], radius=sc(4), fill=CLEAR)  # 门
    d.rectangle([sc(33), sc(66), sc(48), sc(73)], fill=CLEAR)                         # 门底下是直角，通到地面
    return im.resize((81, 81), Image.LANCZOS)


def logo():
    """派圈的图标 → 导航栏用的 128x128 圆角小图标。
    原图的图形（白 T + 红 L）只占中间约四成，缩到 64rpx（32px）会看不清，所以先裁掉四周的空白（图形约占七成）"""
    size = 128
    src = Image.open(BRAND).convert("RGB")
    cx, cy, half = 1056, 1022, 590          # 图形的中心和裁切半径，量自原图
    im = src.crop((cx - half, cy - half, cx + half, cy + half)).resize((size * S, size * S), Image.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=28 * S, fill=255)
    im = im.convert("RGBA")
    im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    house(GRAY).save(ASSETS / "tab-home.png")
    house(RED).save(ASSETS / "tab-home-on.png")
    # 只有黑底、白、红三色和边缘过渡：转成 64 色调色板图，省主包空间（主包上限 2 MB）
    logo().quantize(64, method=Image.Quantize.FASTOCTREE).save(ASSETS / "logo-mark.png", optimize=True)
    print("wrote tab-home.png / tab-home-on.png / logo-mark.png")
