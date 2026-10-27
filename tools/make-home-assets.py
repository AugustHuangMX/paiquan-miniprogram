# -*- coding: utf-8 -*-
"""生成首页（2026-10-27 改版）用到的两组位图：

  assets/tab-home.png / tab-home-on.png   「首页」tab 图标（81x81，和现有图标同一套颜色与实心风格）
  assets/logo-mark.png                     首页导航栏左边的品牌标（红底白字「派」，128x128）

颜色：tab 图标未选中 #8f97a5、选中 #e0353a（从现有 tab 图标采的，同 make-games-tabicon.py）；
品牌标的红用 app.wxss 的 --accent（#d92b2b，白字压上去 4.85:1）。
字体：Noto Sans SC（SIL 开源字体许可，可以随图片分发），Windows 11 自带 C:\\Windows\\Fonts\\NotoSansSC-VF.ttf。
用法：python tools/make-home-assets.py（在仓库根目录跑）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 4                 # 超采样倍数：直接画小图边缘会有锯齿，画 4 倍再 LANCZOS 缩下来
GRAY = (143, 151, 165, 255)
RED = (224, 53, 58, 255)
ACCENT = (217, 43, 43, 255)
CLEAR = (0, 0, 0, 0)
ASSETS = Path(__file__).resolve().parent.parent / "miniprogram" / "assets"
FONT = Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")


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
    """红底圆角方块 + 白字「派」"""
    size = 128
    n = size * S
    im = Image.new("RGBA", (n, n), CLEAR)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=28 * S, fill=ACCENT)
    font = ImageFont.truetype(str(FONT), 84 * S)
    font.set_variation_by_name("Bold")
    box = d.textbbox((0, 0), "派", font=font)
    x = (n - (box[2] - box[0])) / 2 - box[0]
    y = (n - (box[3] - box[1])) / 2 - box[1]
    d.text((x, y), "派", font=font, fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    house(GRAY).save(ASSETS / "tab-home.png")
    house(RED).save(ASSETS / "tab-home-on.png")
    # 只有红、白两色和边缘过渡：转成 64 色调色板图，9 KB → 约 2 KB（主包只剩几十 KB 余量）
    logo().quantize(64, method=Image.Quantize.FASTOCTREE).save(ASSETS / "logo-mark.png", optimize=True)
    print("wrote tab-home.png / tab-home-on.png / logo-mark.png")
