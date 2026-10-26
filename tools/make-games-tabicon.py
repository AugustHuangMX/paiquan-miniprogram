# -*- coding: utf-8 -*-
"""生成「小游戏」tab 图标（81x81 PNG，和现有图标同一套颜色与实心风格）。

现有图标的颜色（从 tab-maps.png / tab-ring.png 采出来的）：
  未选中  #8f97a5  (143,151,165)
  选中    #e0353a  (224,53,58)
形状风格：实心剪影（地图钉、奖杯都是实心），所以这里也画实心手柄。

画法要点：
  · 4 倍超采样后 LANCZOS 缩到 81px —— 直接画 81px 边缘会有明显锯齿；
  · 手柄 = 两个握把圆 + 中间圆角条 的并集，再"挖掉"十字键与两个按键（透明），
    这样读起来是手柄而不是一块圆角矩形。
"""
from PIL import Image, ImageDraw

S = 4                 # 超采样倍数
N = 81 * S
GRAY = (143, 151, 165, 255)
RED = (224, 53, 58, 255)


def gamepad(color):
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def sc(v):
        return int(round(v * S))

    # —— 主体：中间条 + 左右握把（握把比条低，才有"手柄"的轮廓） ——
    d.rounded_rectangle([sc(7), sc(27), sc(74), sc(51)], radius=sc(12), fill=color)
    d.ellipse([sc(5), sc(36), sc(35), sc(66)], fill=color)      # 左握把
    d.ellipse([sc(46), sc(36), sc(76), sc(66)], fill=color)     # 右握把

    # —— 十字键（挖成透明） ——
    d.rounded_rectangle([sc(14), sc(35), sc(31), sc(41)], radius=sc(2), fill=(0, 0, 0, 0))
    d.rounded_rectangle([sc(19), sc(30), sc(26), sc(46)], radius=sc(2), fill=(0, 0, 0, 0))

    # —— 右边两个按键（挖成透明） ——
    d.ellipse([sc(49), sc(30), sc(57), sc(38)], fill=(0, 0, 0, 0))
    d.ellipse([sc(59), sc(39), sc(67), sc(47)], fill=(0, 0, 0, 0))

    return im.resize((81, 81), Image.LANCZOS)


if __name__ == "__main__":
    base = r"D:\点餐\apex-miniapp\miniprogram\assets"
    gamepad(GRAY).save(base + r"\tab-games.png")
    gamepad(RED).save(base + r"\tab-games-on.png")
    print("wrote tab-games.png / tab-games-on.png")
