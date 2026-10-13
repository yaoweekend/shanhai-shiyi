#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
山海拾遗 · 精灵切片 + 自检（批 1 + 批 2，也为后续批次复用）
=============================================================

用法
----
    # 1) 先在 tools/sprites/sheet.html 里改画法，存盘
    # 2) 跑 tools/sprites/build.ps1（Edge 无头截图 + 本脚本），或手工：
    #    python tools/sprites/slice.py
    # 3) 新增/删除槽位时：只改下面 SLOTS 一处（sheet.html 的 SPRITES 要同步），
    #    build.ps1 会按 len(SLOTS) 自动算网格尺寸，不用手改窗口大小。

它会做七件事（幂等，可以反复跑）：
    0. 槽位顺序校验：sheet.html 的 ICON_WEAPONS+ICON_PASSIVES+ICON_EXTRA 顺序必须与
       SLOTS 里的 icon_* 槽位逐位一致（切片按索引取格，顺序一错图就挂错名字）。
    1. 从 _sheet.png 按单元格切出每个槽位，Lanczos 缩放到 manifest 里的确切尺寸，
       写进 assets/sprites/<slot_id>.png（RGBA，透明底）。
    2. 逐张自检：尺寸 / 非空 / 居中 / 四角透明 / 四周不贴边 / 两两不雷同。
       任何一项失败 → 退出码非 0，并在结尾汇总。
    3. 主色检查：角色槽位的非透明像素平均色必须"最像"它自己那一系的主色
       （别把天魄画成绿的）。
    4. 剪影判据（被动图标 v2 的核心）：44px 显示尺寸下的两两 Jaccard 距离，
       24 个被动平均必须 ≥ 0.45、任意一对 ≥ 0.20（见 SIL_* 常数的标定说明）。
    5. 生成 4 倍放大的联络表 test/artifacts/sprites-batch1.png（带槽位名标注）。
    6. 生成 6 个玩家角色的对照图 test/artifacts/chars6.png
       （288px 一格、浅灰底、带名字，用于判断"六个角色是否两两可区分"）。
    7. 生成被动图标 v2 的两张联络表：icons-passives-v2.png（10 倍放大 + 名字）与
       icons-passives-v2-44px.png（按 44px 实际显示尺寸 1:1 渲染的判据图）。

依赖：只用 Pillow + numpy（已装好）。不装任何东西，不联网。

关键参数必须与 sheet.html 保持一致：
    CELL = 256（单元格边长）、ART = 200（单元格内居中的作画正方形）、COLS = 3
如果改了 sheet.html 里的这三个值，这里也要跟着改。
"""

import io
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Windows 控制台默认是 GBK，中文报告会变乱码 → 强制 UTF-8 输出
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# ---------------------------------------------------------------------------
# 路径与参数
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))          # tools/sprites
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))      # shanhai/
SHEET = os.path.join(HERE, '_sheet.png')
SHEET_HTML = os.path.join(HERE, 'sheet.html')
OUT_DIR = os.path.join(ROOT, 'assets', 'sprites')
ARTIFACTS = os.path.join(ROOT, 'test', 'artifacts')
CONTACT = os.path.join(ARTIFACTS, 'sprites-batch1.png')
CONTACT_ZOOM = os.path.join(ARTIFACTS, 'sprites-batch1-zoom.png')
CHARS6_SHEET = os.path.join(ARTIFACTS, 'chars6.png')
CHECK_TXT = os.path.join(ARTIFACTS, 'sprites-batch1.check.txt')

CELL = 256
ART = 200
COLS = 3

# 槽位清单：必须与 sheet.html 的 SPRITES 和 src/assets/manifest.js 一致
# 元组 = (slot_id, 中文名, w, h, batch)；加新批次时只在这里追加，
# build.ps1 会按 len(SLOTS) 自动算网格尺寸。
SLOTS = [
    # ---- 批 1（9 张：3 角色 + 5 敌人 + Boss）----
    ('char_shanpo',      '山魄',   32,  32,  1),
    ('char_haipo',       '海魄',   32,  32,  1),
    ('char_huangpo',     '荒魄',   32,  32,  1),
    ('enemy_shanxiao',   '山魈',   28,  28,  1),
    ('enemy_bifang',     '毕方',   30,  30,  1),
    ('enemy_huashe',     '化蛇',   28,  28,  1),
    ('enemy_xinang',     '傒囊',   26,  26,  1),
    ('enemy_qiangliang', '强良',   36,  36,  1),
    ('boss_xiangliu',    '相柳',   132, 132, 1),
    # ---- 批 2（3 张：第 4~6 系玩家角色）----
    ('char_tianpo',      '天魄',   32,  32,  2),
    ('char_wupo',        '巫魄',   32,  32,  2),
    ('char_busipo',      '不死魄', 32,  32,  2),

    # ---- 批 3（51 张：道具图标）----
    # 24 武器 + 24 被动 + 通用被动/超武/掉落。清单顺序必须与 sheet.html 的
    # ICON_WEAPONS + ICON_PASSIVES + ICON_EXTRA 完全一致（切片是按索引取格的）。
    # 槽位 id 与尺寸以 src/assets/manifest.js 实际派生出来的 51 个为准
    # （icon_drop 是唯一一个 12×12 的）。
    *[(i, c, 12 if i == 'icon_drop' else 24, 12 if i == 'icon_drop' else 24, 3) for (i, c, _s) in [
        ('icon_w_shoujia', '兽甲旋刃', 'shan'), ('icon_w_guhai', '骨骸回旋', 'shan'),
        ('icon_w_lizhao', '利爪横扫', 'shan'), ('icon_w_shanbeng', '山崩践踏', 'shan'),
        ('icon_w_linyu', '鳞雨散射', 'hai'), ('icon_w_jiaozhu', '鲛珠追踪', 'hai'),
        ('icon_w_jingxi', '鲸息贯穿', 'hai'), ('icon_w_haimao', '海茅穿刺', 'hai'),
        ('icon_w_huanglei', '荒雷落顶', 'huang'), ('icon_w_zhangqi', '瘴气毒雾', 'huang'),
        ('icon_w_zhaoyin', '召引荒兽', 'huang'), ('icon_w_dahuangfeng', '大荒风眼', 'huang'),
        ('icon_w_rijian', '日珥箭', 'tian'), ('icon_w_jiguang', '极光追魂', 'tian'),
        ('icon_w_riyue', '日月双环', 'tian'), ('icon_w_tianji', '天极贯日', 'tian'),
        ('icon_w_wugu', '巫蛊引', 'ling'), ('icon_w_shigu', '蚀骨蛊', 'ling'),
        ('icon_w_shiwu', '十巫幡', 'ling'), ('icon_w_lingwu', '灵雾噬魂', 'ling'),
        ('icon_w_kunlun_1', '昆仑玉琮', 'kun'), ('icon_w_kunlun_2', '悬圃垂露', 'kun'),
        ('icon_w_kunlun_3', '昆吾剑气', 'kun'), ('icon_w_kunlun_4', '开明守御', 'kun'),
        ('icon_passive_xuangui', '玄龟甲', 'shan'), ('icon_passive_kuiniu', '夔牛蹄', 'shan'),
        ('icon_passive_shanyueji', '山岳脊', 'shan'), ('icon_passive_dangkangya', '当康牙', 'shan'),
        ('icon_passive_jiuweiyi', '九尾尾', 'hai'), ('icon_passive_kunpengyi', '鲲鹏翼', 'hai'),
        ('icon_passive_shenglouzhu', '蜃楼珠', 'hai'), ('icon_passive_jiaorenyan', '鲛人泪', 'hai'),
        ('icon_passive_zhulongtong', '烛龙瞳', 'huang'), ('icon_passive_zhurongjin', '祝融烬', 'huang'),
        ('icon_passive_qiongqixiu', '穷奇嗅', 'huang'), ('icon_passive_bashetun', '巴蛇吞', 'huang'),
        ('icon_passive_houyigong', '后羿弓', 'tian'), ('icon_passive_kuafuzhong', '夸父踵', 'tian'),
        ('icon_passive_nvwashi', '女娲石', 'tian'), ('icon_passive_jingweiwei', '精卫喙', 'tian'),
        ('icon_passive_wuxianfu', '巫咸符', 'ling'), ('icon_passive_gumumin', '蛊母皿', 'ling'),
        ('icon_passive_lingshanwu', '灵山雾', 'ling'), ('icon_passive_shiwufan', '十巫幡', 'ling'),
        ('icon_passive_busiyao', '不死药', 'kun'), ('icon_passive_xuanpuzhi', '悬圃芝', 'kun'),
        ('icon_passive_kunlunyu', '昆仑玉膏', 'kun'), ('icon_passive_luwushou', '陆吾守', 'kun'),
        ('icon_passive', '被动图标', 'shan'), ('icon_super', '超武图标', 'gold'),
        ('icon_drop', '掉落物', 'hai'),
    ]],
]

# ---- 批 3 的分组（两两不撞脸要按"会同时出现在同一张卡片列表里"的口径做）----
ICON_WEAPON_IDS = [s[0] for s in SLOTS if s[0].startswith('icon_w_')]
ICON_PASSIVE_IDS = [s[0] for s in SLOTS if s[0].startswith('icon_passive_')]
ICON_48 = ICON_WEAPON_IDS + ICON_PASSIVE_IDS          # 任务书要求的 24 + 24
ICON_49 = ICON_48 + ['icon_passive']                  # 通用被动图标也和它们同框
ICON_SPECIAL = ['icon_super', 'icon_drop']
# 各图标所属神系（只用于打印"配色是否贴合本系"的信息，不判失败：
# 图标里有骨白/暗色这类中性墨，平均色天然会被拉灰）
ICON_SERIES = {
    'icon_w_shoujia': 'shan', 'icon_w_guhai': 'shan', 'icon_w_lizhao': 'shan', 'icon_w_shanbeng': 'shan',
    'icon_w_linyu': 'hai', 'icon_w_jiaozhu': 'hai', 'icon_w_jingxi': 'hai', 'icon_w_haimao': 'hai',
    'icon_w_huanglei': 'huang', 'icon_w_zhangqi': 'huang', 'icon_w_zhaoyin': 'huang', 'icon_w_dahuangfeng': 'huang',
    'icon_w_rijian': 'tian', 'icon_w_jiguang': 'tian', 'icon_w_riyue': 'tian', 'icon_w_tianji': 'tian',
    'icon_w_wugu': 'ling', 'icon_w_shigu': 'ling', 'icon_w_shiwu': 'ling', 'icon_w_lingwu': 'ling',
    'icon_w_kunlun_1': 'kun', 'icon_w_kunlun_2': 'kun', 'icon_w_kunlun_3': 'kun', 'icon_w_kunlun_4': 'kun',
    'icon_passive_xuangui': 'shan', 'icon_passive_kuiniu': 'shan', 'icon_passive_shanyueji': 'shan',
    'icon_passive_dangkangya': 'shan', 'icon_passive_jiuweiyi': 'hai', 'icon_passive_kunpengyi': 'hai',
    'icon_passive_shenglouzhu': 'hai', 'icon_passive_jiaorenyan': 'hai', 'icon_passive_zhulongtong': 'huang',
    'icon_passive_zhurongjin': 'huang', 'icon_passive_qiongqixiu': 'huang', 'icon_passive_bashetun': 'huang',
    'icon_passive_houyigong': 'tian', 'icon_passive_kuafuzhong': 'tian', 'icon_passive_nvwashi': 'tian',
    'icon_passive_jingweiwei': 'tian', 'icon_passive_wuxianfu': 'ling', 'icon_passive_gumumin': 'ling',
    'icon_passive_lingshanwu': 'ling', 'icon_passive_shiwufan': 'ling', 'icon_passive_busiyao': 'kun',
    'icon_passive_xuanpuzhi': 'kun', 'icon_passive_kunlunyu': 'kun', 'icon_passive_luwushou': 'kun',
    'icon_passive': 'shan', 'icon_super': 'gold', 'icon_drop': 'hai',
}

# 道具图标联络表（任务书指定的三个文件）
ICONS_WEAPONS_SHEET = os.path.join(ARTIFACTS, 'icons-weapons.png')
ICONS_PASSIVES_SHEET = os.path.join(ARTIFACTS, 'icons-passives.png')
ICONS_SPECIAL_SHEET = os.path.join(ARTIFACTS, 'icons-special.png')
# 被动图标 v2 的两张联络表（任务书指定）：放大带名字 + 44px 实际显示尺寸的判据图
ICONS_PASSIVES_V2_SHEET = os.path.join(ARTIFACTS, 'icons-passives-v2.png')
ICONS_PASSIVES_V2_44 = os.path.join(ARTIFACTS, 'icons-passives-v2-44px.png')

# 六个玩家角色（批 1 三系 + 批 2 三系）——"六张两两不撞脸"专门对它们量化
CHARS6 = ['char_shanpo', 'char_haipo', 'char_huangpo',
          'char_tianpo', 'char_wupo', 'char_busipo']

# 各系主色：直接抄 src/content/series.js 的 color（主色必须取自这里，不许自己发明）
SERIES_MAIN = {
    'shan':  '#c9553d',
    'hai':   '#2f7fb8',
    'huang': '#6f5aa8',
    'tian':  '#d9a02b',
    'ling':  '#2f9e8f',
    'kun':   '#8a93a8',
}
# 角色槽位 → 它所属的系（主色检查用）
CHAR_SERIES = {
    'char_shanpo': 'shan',
    'char_haipo': 'hai',
    'char_huangpo': 'huang',
    'char_tianpo': 'tian',
    'char_wupo': 'ling',
    'char_busipo': 'kun',
}

# 自检阈值
CENTER_TOL = 0.15      # 上下/左右留白之差 ≤ 画布尺寸的 15%
EDGE_MIN = 1           # 四周至少留 1 像素透明边（贴边 = 游戏里看着被裁掉，判失败）
HUE_TOL = 45.0         # 非透明像素平均色与所属系主色的色相偏差上限（度）
FP_MIN = 4.0           # 8×8 灰度指纹平均绝对差下限（与 test/sprites.mjs 同口径）
PIX_MIN = 8.0          # 64×64 RGBA 平均绝对差下限（"明显不一样"的量级）
HIST_MAX = 0.97        # 颜色直方图交叠系数上限

# ---- 剪影判据（被动图标 v2 的核心判据，见文件末尾的 SIL_* 说明）----
# 卡片上的实际显示尺寸是 44px：把成品用与流水线同一套"预乘 alpha + Lanczos"放大到
# 44×44，取 alpha > SIL_THR 当剪影，再算两两 Jaccard 距离（1 - 交/并，越大越不像）。
# 阈值 SIL_THR=15 是标定出来的：用这组参数量**重画之后**的 v1 素材（重画前的成品），
# 24 个被动的平均 0.366 / 最差一对 0.121、24 个武器的平均 0.443，与任务书给的
# 0.367 / 0.124 / 0.435 完全对得上（差 ≤0.008）——所以这套口径和任务书是同一把尺子。
SIL_SIZE = 44
SIL_THR = 15
SIL_AVG_MIN = 0.45     # 24 个被动两两剪影差异的平均值下限
SIL_PAIR_MIN = 0.20    # 任意一对的剪影差异下限（原来最差只有 0.124）
# 重画前的基线（用上面同一把尺子量出来的，供新旧对比）
SIL_BASELINE = {'passive_avg': 0.366, 'passive_min': 0.121, 'passive_min_pair': 'icon_passive_shanyueji vs icon_passive_xuangui',
                'weapon_avg': 0.443}


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def check_sheet_order():
    """
    顺序一致性检查（切片是按**索引**取格的）：
    sheet.html 里 ICON_WEAPONS + ICON_PASSIVES + ICON_EXTRA 的 id 顺序必须与 SLOTS
    里 icon_* 槽位的顺序逐位相同。不一致 → 图标会被写进**别人的文件名**。
    这坑真踩过：被动最后 5 张（十巫幡/不死药/悬圃芝/昆仑玉膏/陆吾守）整体错位一格起，
    自检全过、图全对，但每一个都挂在错的名字上。所以这里做一次静态校验。
    """
    if not os.path.exists(SHEET_HTML):
        return ['找不到 %s，无法校验槽位顺序' % SHEET_HTML]
    with io.open(SHEET_HTML, encoding='utf-8', errors='replace') as f:
        text = f.read()
    try:
        region = text[text.index('const ICON_WEAPONS'):text.index('const ICON_DEFS')]
    except ValueError:
        return ['sheet.html 里找不到 ICON_WEAPONS / ICON_DEFS 区块，无法校验槽位顺序']
    have = re.findall(r"\{ id: '([a-z0-9_]+)'", region)
    want = [s[0] for s in SLOTS if s[0].startswith('icon_')]
    print('-' * 78)
    print('槽位顺序校验：sheet.html 的 ICON_* 顺序 vs slice.py 的 SLOTS 顺序')
    if have == want:
        print('  %d 个道具图标逐位一致（%s ... %s）' % (len(want), want[0], want[-1]))
        return []
    bad = []
    for i in range(max(len(have), len(want))):
        h = have[i] if i < len(have) else '(缺)'
        w = want[i] if i < len(want) else '(缺)'
        if h != w:
            bad.append('  第 %d 位：sheet.html=%s   SLOTS=%s' % (i + 1, h, w))
    print('[FAIL] sheet.html 与 SLOTS 的顺序不一致 —— 图标会被写进别人的文件名：')
    for b in bad[:12]:
        print(b)
    if len(bad) > 12:
        print('  ... 共 %d 处不一致' % len(bad))
    return ['sheet.html 与 slice.py 的槽位顺序不一致（%d 处），会把图标写进别人的文件名' % len(bad)]


def crop_art(sheet: Image.Image, index: int) -> Image.Image:
    """取出第 index 个槽位在网格图里的 200×200 作画区（居中正方形）。"""
    col, row = index % COLS, index // COLS
    cx = col * CELL + CELL // 2
    cy = row * CELL + CELL // 2
    half = ART // 2
    return sheet.crop((cx - half, cy - half, cx + half, cy + half))


def downscale_premultiplied(img: Image.Image, w: int, h: int) -> Image.Image:
    """
    带 alpha 的正确缩放：先预乘 alpha，再 Lanczos 缩小，再反预乘。
    直接缩放 RGBA 会让透明像素的 RGB（往往是 0 或白）渗进边缘，产生脏边。
    """
    a = np.asarray(img.convert('RGBA'), dtype=np.float64)
    alpha = a[:, :, 3:4] / 255.0
    premul = np.concatenate([a[:, :, :3] * alpha, a[:, :, 3:4]], axis=2)
    small = np.asarray(
        Image.fromarray(premul.round().clip(0, 255).astype(np.uint8), 'RGBA')
        .resize((w, h), Image.LANCZOS),
        dtype=np.float64,
    )
    sa = small[:, :, 3:4] / 255.0
    rgb = np.where(sa > 1e-6, small[:, :, :3] / np.maximum(sa, 1e-6), 0.0)
    out = np.concatenate([rgb.clip(0, 255), small[:, :, 3:4].clip(0, 255)], axis=2)
    return Image.fromarray(out.round().astype(np.uint8), 'RGBA')


def find_font(size: int):
    """找一个能显示中文的字体；找不到就退回 PIL 默认字体（联络表的英文标注仍可读）。"""
    for path in (
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\msyhl.ttc',
        r'C:\Windows\Fonts\simhei.ttf',
        r'C:\Windows\Fonts\simsun.ttc',
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# 自检
# ---------------------------------------------------------------------------
def check_sprite(path: str, slot_id: str, cn: str, w: int, h: int) -> dict:
    """单张自检。返回 {ok, errors, info}。"""
    errors = []
    info = {}
    if not os.path.exists(path):
        return {'ok': False, 'errors': ['文件不存在'], 'info': info}

    im = Image.open(path)
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    iw, ih = im.size
    info['size'] = (iw, ih)

    # 1) 尺寸必须精确
    if (iw, ih) != (w, h):
        errors.append('尺寸不符：期望 %dx%d，实际 %dx%d' % (w, h, iw, ih))

    arr = np.asarray(im, dtype=np.uint8)
    alpha = arr[:, :, 3]
    mask = alpha > 0

    # 2) 必须有非透明像素（空图必须报错）
    if not mask.any():
        errors.append('整张全透明（空图）')
        return {'ok': False, 'errors': errors, 'info': info}

    # 3) 四角 alpha 必须为 0（透明背景）
    corners = {
        '左上': arr[0, 0, 3], '右上': arr[0, iw - 1, 3],
        '左下': arr[ih - 1, 0, 3], '右下': arr[ih - 1, iw - 1, 3],
    }
    bad_corners = {k: int(v) for k, v in corners.items() if v != 0}
    if bad_corners:
        errors.append('四角非全透明：%s' % bad_corners)

    # 4) 包围盒 + 居中 + 不贴边
    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    left, right = x0, iw - 1 - x1
    top, bottom = y0, ih - 1 - y1
    info['bbox'] = (x0, y0, x1, y1)
    info['margins'] = (left, top, right, bottom)
    if left < EDGE_MIN or top < EDGE_MIN or right < EDGE_MIN or bottom < EDGE_MIN:
        errors.append('内容贴边（要求四周 ≥%dpx 透明）：留白 L%d T%d R%d B%d'
                      % (EDGE_MIN, left, top, right, bottom))
    dx = abs(left - right) / float(iw)
    dy = abs(top - bottom) / float(ih)
    info['center_off'] = (round(dx, 3), round(dy, 3))
    if dx > CENTER_TOL:
        errors.append('左右偏心 %.1f%% > %.0f%%（留白 L%d R%d）' % (dx * 100, CENTER_TOL * 100, left, right))
    if dy > CENTER_TOL:
        errors.append('上下偏心 %.1f%% > %.0f%%（留白 T%d B%d）' % (dy * 100, CENTER_TOL * 100, top, bottom))

    # 5) 覆盖率（信息用，不判失败）：太小说明画得太吝啬，太大说明没留白
    info['coverage'] = round(float(mask.mean()), 3)
    return {'ok': not errors, 'errors': errors, 'info': info}


def check_distinct(images: dict):
    """
    独特性：两两比较。
    用两种互补的度量，任一"过于相似"就判失败：
      · 像素差：把两张图缩到同一尺寸，比较 RGBA 平均绝对差（含 alpha 通道，
        这样"形状不同"也能被抓住）；
      · 颜色直方图：比较 3D RGB 直方图的交叠系数。
    阈值是"明显不一样"的量级：逐像素差 < 8/255 或直方图相似度 > 0.97 视为雷同。
    """
    ids = list(images.keys())
    problems = []
    ratios = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a_id, b_id = ids[i], ids[j]
            r = pair_metrics(images[a_id], images[b_id])
            ratios.append((a_id, b_id, r['pix_diff'], r['overlap'], r['fp_diff']))
            if r['pix_diff'] < PIX_MIN or r['overlap'] > HIST_MAX or r['fp_diff'] < FP_MIN:
                problems.append('%s vs %s：像素差 %.2f（阈值 %.0f）、直方图重叠 %.3f（阈值 %.2f）、'
                                '指纹差 %.1f（阈值 %.1f）'
                                % (a_id, b_id, r['pix_diff'], PIX_MIN, r['overlap'], HIST_MAX,
                                   r['fp_diff'], FP_MIN))
    return problems, ratios


def fingerprint8(im: Image.Image) -> np.ndarray:
    """8×8 灰度指纹 —— 与 test/sprites.mjs 的撞脸检测同口径。"""
    return np.asarray(im.convert('L').resize((8, 8), Image.BILINEAR), dtype=np.float64)


def color_hist(x: np.ndarray) -> np.ndarray:
    """3D RGB 直方图（32 级/通道，只看非透明像素），L1 归一化。"""
    rgb = x[:, :, :3].astype(np.int32)
    idx = (rgb[:, :, 0] // 32) * 64 + (rgb[:, :, 1] // 32) * 8 + (rgb[:, :, 2] // 32)
    m = (x[:, :, 3] > 16).ravel()
    hh = np.bincount(idx.ravel()[m], minlength=512).astype(np.float64)
    return hh / max(1.0, hh.sum())


def pair_metrics(a: Image.Image, b: Image.Image) -> dict:
    """两张精灵图的三种差异度量（跨尺寸安全：都缩到同一尺寸再比）。"""
    S = 64
    aa = np.asarray(a.resize((S, S), Image.LANCZOS), dtype=np.float64)
    bb = np.asarray(b.resize((S, S), Image.LANCZOS), dtype=np.float64)
    ha, hb = color_hist(aa), color_hist(bb)
    return {
        'pix_diff': float(np.abs(aa - bb).mean()),                       # 0..255
        'overlap': float(np.minimum(ha, hb).sum()),                      # 1 = 完全一样
        'fp_diff': float(np.abs(fingerprint8(a) - fingerprint8(b)).mean()),
    }


# ---------------------------------------------------------------------------
# 剪影判据：44px 显示尺寸下的两两 Jaccard 距离
# ---------------------------------------------------------------------------
def silhouette44(im: Image.Image) -> np.ndarray:
    """
    卡片上的实际显示尺寸（44px）下的剪影掩码。
    用与出图同一套「预乘 alpha + Lanczos」把 24×24 放大到 44×44（这样测的就是玩
    家真正看到的那张图），再取 alpha > SIL_THR 当剪影。
    """
    big = downscale_premultiplied(im.convert('RGBA'), SIL_SIZE, SIL_SIZE)
    return np.asarray(big.getchannel('A'), dtype=np.float64) > SIL_THR


def jaccard_sil(a: np.ndarray, b: np.ndarray) -> float:
    """剪影 Jaccard 距离：1 - 交/并。0 = 完全重合，1 = 毫无交集。"""
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(1.0 - inter / max(1, union))


def silhouette_rows(images: dict, ids) -> list:
    """一组图标的两两剪影差异，返回 [(a, b, dist, area_a, area_b)]。"""
    masks = {i: silhouette44(images[i]) for i in ids if i in images}
    rows = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if a not in masks or b not in masks:
                continue
            rows.append((a, b, jaccard_sil(masks[a], masks[b]),
                         int(masks[a].sum()), int(masks[b].sum())))
    return rows


# ---------------------------------------------------------------------------
# 主色检查：非透明像素的平均色必须"最像"本系主色
# ---------------------------------------------------------------------------
def hex_to_rgb(h: str):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(c) -> str:
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in c)


def chroma(c):
    """色度（把明度除掉）：暗部的平均色也能和饱和的主色比。"""
    s = float(sum(c)) or 1.0
    return np.array([v / s for v in c], dtype=np.float64)


def hue_of(c):
    r, g, b = [v / 255.0 for v in c]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d < 1e-6:
        return None
    if mx == r:
        h = 60.0 * (((g - b) / d) % 6)
    elif mx == g:
        h = 60.0 * ((b - r) / d + 2)
    else:
        h = 60.0 * ((r - g) / d + 4)
    return h % 360.0


def hue_delta(a, b) -> float:
    if a is None or b is None:
        return 0.0
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def avg_visible_color(im: Image.Image):
    """非透明像素（alpha>8）的平均 RGB；全是透明像素时返回 None。"""
    arr = np.asarray(im.convert('RGBA'), dtype=np.float64)
    m = arr[:, :, 3] > 8
    if not m.any():
        return None
    return arr[:, :, :3][m].mean(axis=0)


def saturation_of(c):
    mx, mn = max(c), min(c)
    return 0.0 if mx <= 0 else (mx - mn) / float(mx)


def check_main_color(slot_id: str, im: Image.Image) -> dict:
    """
    主色检查：非透明像素的平均色必须"就是本系那个颜色"，判据三条一起看：
      1. 色相：平均色与主色的色相偏差 ≤ HUE_TOL 度（这一条是身份识别的主力，
         因为平均色天然比主色暗、也比主色淡——有深色描边和暗部）；
      2. 归类：六个系主色里，色相最接近的必须是本系（别把天魄画成绿的）；
      3. 饱和度下限：平均色的饱和度不能低到近乎中性灰（防止"洗成灰色也算过"）。
    色度（chroma）距离只作为参考信息打印，不单独判失败：平均色被描边拉暗后，
    色度会整体偏向灰色，用它近邻分类会误判——这一条踩过坑。
    """
    series = CHAR_SERIES[slot_id]
    want = hex_to_rgb(SERIES_MAIN[series])
    avg = avg_visible_color(im)
    info = {'series': series, 'want': SERIES_MAIN[series]}
    if avg is None:
        return {'ok': False, 'errors': ['整张全透明，无法算主色'], 'info': info}
    ha, hw = hue_of(avg), hue_of(want)
    nearest = min(SERIES_MAIN, key=lambda k: hue_delta(ha, hue_of(hex_to_rgb(SERIES_MAIN[k]))))
    hd = hue_delta(ha, hw)
    sat = saturation_of(avg)
    sat_main = saturation_of(want)
    sat_floor = max(0.08, 0.2 * sat_main)
    info.update({'avg': rgb_to_hex(avg), 'avg_rgb': tuple(round(v, 1) for v in avg),
                 'nearest': nearest, 'hue': None if ha is None else round(ha, 1),
                 'hue_delta': round(hd, 1), 'sat': round(sat, 3),
                 'sat_floor': round(sat_floor, 3),
                 'chroma_dist': round(float(np.linalg.norm(chroma(avg) - chroma(want))), 3)})
    errors = []
    if hd > HUE_TOL:
        errors.append('平均色 %s 与主色 %s 的色相偏差 %.1f° > %.0f°'
                      % (info['avg'], SERIES_MAIN[series], hd, HUE_TOL))
    if nearest != series:
        errors.append('平均色 %s 的色相最接近「%s」系（%s），而不是本系「%s」(%s)'
                      % (info['avg'], nearest, SERIES_MAIN[nearest], series, SERIES_MAIN[series]))
    if sat < sat_floor:
        errors.append('平均色 %s 饱和度 %.3f < 下限 %.3f（快被洗成中性灰了）'
                      % (info['avg'], sat, sat_floor))
    return {'ok': not errors, 'errors': errors, 'info': info}


def check_chars6(images: dict):
    """
    六个玩家角色的两两对照（"六张必须一眼分得开"）。
    三种度量同时给出，任一不达标即失败；并回报最接近的一对及其余量。
    """
    problems = []
    rows = []
    for i in range(len(CHARS6)):
        for j in range(i + 1, len(CHARS6)):
            a, b = CHARS6[i], CHARS6[j]
            if a not in images or b not in images:
                continue
            r = pair_metrics(images[a], images[b])
            rows.append((a, b, r))
            if r['pix_diff'] < PIX_MIN or r['overlap'] > HIST_MAX or r['fp_diff'] < FP_MIN:
                problems.append('%s vs %s：像素差 %.2f / 指纹差 %.1f / 直方图重叠 %.3f'
                                % (a, b, r['pix_diff'], r['fp_diff'], r['overlap']))
    return problems, rows


# ---------------------------------------------------------------------------
# 六角色对照图（浅灰底、放大约 300px、带名字）
# ---------------------------------------------------------------------------
def build_chars6(images: dict, path: str, scale: int = 9, pad: int = 22, header: int = 40):
    """
    6 个玩家角色的对照图：每格 scale 倍最近邻放大（默认 9 倍 → 288px，正好 300px 左右），
    浅灰底（不是棋盘格，避免和精灵里的冷白/浅金混淆），每格标注中文名 / 槽位 id / 神系。
    """
    font_small = find_font(14)
    font_id = find_font(13)
    cols, cell = 3, 32 * scale
    cw = cell + pad * 2
    ch = cell + pad * 2 + header
    sheet = Image.new('RGB', (cw * cols, ch * 2), (228, 228, 231))
    d = ImageDraw.Draw(sheet)
    title_fonts = [(s, find_font(s)) for s in (22, 20, 18, 16, 14)]
    for k, slot_id in enumerate(CHARS6):
        if slot_id not in images:
            continue
        series = CHAR_SERIES[slot_id]
        cn = next((s[1] for s in SLOTS if s[0] == slot_id), slot_id)
        title = '%s（%s）· %s' % (cn, slot_id, series)
        font = title_fonts[-1][1]
        for _sz, f in title_fonts:          # 自动缩到能塞进格子（否则右边会被裁掉）
            if d.textlength(title, font=f) <= cw - pad * 2:
                font = f
                break
        col, row = k % cols, k // cols
        ox, oy = col * cw, row * ch
        d.rectangle([ox + 1, oy + 1, ox + cw - 2, oy + ch - 2],
                    fill=(240, 240, 242), outline=(150, 150, 156), width=2)
        d.text((ox + pad, oy + 9), title, font=font, fill=(28, 28, 34))
        d.text((ox + pad, oy + 9 + 26), '主色 %s' % SERIES_MAIN[series], font=font_small, fill=(90, 90, 98))
        big = images[slot_id].resize((cell, cell), Image.NEAREST)
        bx, by = ox + pad, oy + pad + header
        sheet.paste(big, (bx, by), big)
        d.rectangle([bx - 1, by - 1, bx + cell, by + cell], outline=(170, 170, 176))
        d.text((ox + pad, oy + ch - 20), '实际 32×32 · %d 倍放大' % scale, font=font_id, fill=(110, 110, 118))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return sheet.size
# ---------------------------------------------------------------------------
# 联络表
# ---------------------------------------------------------------------------
def build_contact_sheet(pairs, path, scale=4, pad=18, header=40):
    """把成品按 scale 倍最近邻放大，拼成带槽位名标注的联络表。pairs = [(id, cn, w, h, img)]"""
    font = find_font(20)
    font_small = find_font(15)
    cell_w = max(p[2] for p in pairs) * scale
    cell_h = max(p[3] for p in pairs) * scale
    cols = 3
    rows = (len(pairs) + cols - 1) // cols
    cw = cell_w + pad * 2
    ch = cell_h + pad * 2 + header
    sheet = Image.new('RGBA', (cw * cols, ch * rows), (16, 15, 20, 255))
    d = ImageDraw.Draw(sheet)
    for k, (slot_id, cn, w, h, img) in enumerate(pairs):
        col, row = k % cols, k // cols
        ox, oy = col * cw, row * ch
        # 单元格底 + 边框
        d.rectangle([ox + 1, oy + 1, ox + cw - 2, oy + ch - 2], fill=(24, 22, 28, 255),
                    outline=(70, 64, 52, 255), width=2)
        d.text((ox + pad, oy + 10), '%s  %s  %dx%d' % (slot_id, cn, w, h), font=font, fill=(240, 179, 87, 255))
        big = img.resize((w * scale, h * scale), Image.NEAREST)
        bx = ox + pad + (cell_w - w * scale) // 2
        by = oy + pad + header
        # 棋盘格底：确认"透明"是真的透明，而不是画了黑底
        for yy in range(0, h * scale, 12):
            for xx in range(0, w * scale, 12):
                c = (58, 56, 66, 255) if ((xx // 12 + yy // 12) % 2 == 0) else (42, 40, 50, 255)
                d.rectangle([bx + xx, by + yy, bx + min(xx + 11, w * scale - 1), by + min(yy + 11, h * scale - 1)], fill=c)
        sheet.alpha_composite(big, (bx, by))
        d.rectangle([bx - 1, by - 1, bx + w * scale, by + h * scale], outline=(120, 110, 90, 255))
        d.text((ox + pad, oy + ch - 22), '实际尺寸 %dx%d · %d 倍放大' % (w, h, scale),
               font=font_small, fill=(150, 145, 135, 255))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return sheet.size


# ---------------------------------------------------------------------------
# 批 3 道具图标：两两不撞脸（三度量互相印证）+ 联络表
# ---------------------------------------------------------------------------
def cn_of(slot_id: str) -> str:
    for s in SLOTS:
        if s[0] == slot_id:
            return s[1]
    return slot_id


def gmin(rows, key):
    """rows = [(a, b, metrics)]，取某个度量的最小/最大极值行。"""
    if not rows:
        return None
    return min(rows, key=lambda r: r[2][key])


def gmax(rows, key):
    if not rows:
        return None
    return max(rows, key=lambda r: r[2][key])


def icon_pairs(images, ids):
    rows = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if a in images and b in images:
                rows.append((a, b, pair_metrics(images[a], images[b])))
    return rows


def check_icon_group(images, ids, title, report_only=False):
    """
    一组图标的两两不撞脸：像素差 / 灰度指纹 / 颜色直方图 三种度量都给出最小值
    （直方图给最大值），并指出最接近的那一对。
    返回 (problems, rows)。
    """
    rows = icon_pairs(images, ids)
    problems = []
    for a, b, r in rows:
        if r['pix_diff'] < PIX_MIN or r['overlap'] > HIST_MAX or r['fp_diff'] < FP_MIN:
            problems.append('%s vs %s：像素差 %.2f（下限 %.0f）、指纹差 %.1f（下限 %.1f）、直方图重叠 %.3f（上限 %.2f）'
                            % (a, b, r['pix_diff'], PIX_MIN, r['fp_diff'], FP_MIN, r['overlap'], HIST_MAX))
    print('%s：%d 张 → %d 对' % (title, len(ids), len(rows)))
    for key, name, worse in (('pix_diff', '像素差（越大越不像）', 'min'),
                             ('fp_diff', '灰度指纹差（越大越不像）', 'min'),
                             ('overlap', '颜色直方图重叠（越小越不像）', 'max')):
        row = (gmin(rows, key) if worse == 'min' else gmax(rows, key))
        if row is None:
            continue
        a, b, r = row
        print('  · %-22s 最小值 %-6.2f  ← %s（%s）vs %s（%s）'
              % (name, r[key], cn_of(a), a, cn_of(b), b) if worse == 'min' else
              '  · %-22s 最大值 %-6.3f  ← %s（%s）vs %s（%s）'
              % (name, r[key], cn_of(a), a, cn_of(b), b))
    if problems:
        if not report_only:
            print('[FAIL] %s 里有长得太像的：' % title)
        for p in problems:
            print('       - %s' % p)
    else:
        print('  结论：%d 对全部达标（三种度量都留有明显余量）' % len(rows))
    return problems, rows


def build_passive_44_sheet(entries, path, cols=6, cell=150, pad=14, header=44, strip_pad=18):
    """
    「44px 实际显示尺寸」判据图（被动图标 v2）。
    每格：把 24×24 用出图同一套预乘 Lanczos 放大到 44×44 后 **1:1** 贴在卡片底色上
    （就是玩家在卡片上看到的真实大小），左上角再贴一张 4 倍放大做对照；
    最下面一条把 24 张按 44px 排成一行 —— 直接看"缩到卡片大小还分不分得出来"。
    """
    font_name = find_font(19)
    font_small = find_font(13)
    cw = cell + pad * 2
    ch = header + cell + pad
    rows = (len(entries) + cols - 1) // cols
    # 底部整行平铺要有 24 张的位置（早先按 cols 算宽度 → 第 7 张起会被裁掉）
    strip_w = 24 + len(entries) * (SIL_SIZE + 12)
    W = max(cw * cols, strip_w)
    H = ch * rows + strip_pad + SIL_SIZE + 46
    sheet = Image.new('RGB', (W, H), (222, 222, 228))
    d = ImageDraw.Draw(sheet)
    for k, (slot_id, cn, series, img) in enumerate(entries):
        col, row = k % cols, k // cols
        ox, oy = col * cw, row * ch
        d.rectangle([ox + 1, oy + 1, ox + cw - 2, oy + ch - 2],
                    fill=(238, 238, 242), outline=(140, 140, 148), width=2)
        d.text((ox + pad, oy + 8), cn, font=font_name, fill=(26, 26, 32))
        d.text((ox + pad, oy + 30), slot_id, font=font_small, fill=(96, 96, 106))
        big = downscale_premultiplied(img, SIL_SIZE, SIL_SIZE)     # 44px：玩家实际看到的
        slot_x = ox + pad + 6
        slot_y = oy + header + 10
        d.rectangle([slot_x - 6, slot_y - 6, slot_x + SIL_SIZE + 6, slot_y + SIL_SIZE + 6],
                    fill=(46, 42, 54), outline=(120, 112, 96), width=2)   # 卡片图标槽底色
        sheet.paste(big, (slot_x, slot_y), big)
        # 参考：4 倍最近邻放大（看清画的是什么物件）
        zx = slot_x + SIL_SIZE + 16
        zy = oy + header + 6
        zoom = img.resize((96, 96), Image.NEAREST)
        d.rectangle([zx - 1, zy - 1, zx + 96, zy + 96], outline=(176, 176, 184))
        sheet.paste(zoom, (zx, zy), zoom)
        d.text((zx, zy + 100), '4×', font=font_small, fill=(110, 110, 120))
        d.text((slot_x - 6, slot_y + SIL_SIZE + 12), '↑ 44px 实际大小', font=font_small, fill=(110, 110, 120))
    # 底部：24 张 44px 排成一行（卡片列表的真实观感）
    sy = ch * rows + strip_pad
    d.rectangle([0, sy - 8, W - 1, H - 1], fill=(30, 28, 36))
    d.text((12, sy), '同一行按 44px 实际显示尺寸平铺（这就是卡片列表里看到的样子）',
           font=font_small, fill=(240, 179, 87))
    x = 12
    for slot_id, cn, series, img in entries:
        big = downscale_premultiplied(img, SIL_SIZE, SIL_SIZE)
        ty = sy + 22
        sheet.paste(big, (x, ty), big)
        x += SIL_SIZE + 12
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return sheet.size


def build_icon_sheet(entries, path, cell=240, cols=4, pad=18, header=56, footer=34):
    """
    道具图标联络表：每格等大（最近邻放大到 cell 见方：24px→10 倍、12px→20 倍），
    浅灰底 + 中文名 + 槽位 id + 神系，右下角再贴一张 1:1 实际大小的对照。
    entries = [(slot_id, cn, series, img)]
    """
    font_name = find_font(21)
    font_small = find_font(14)
    cw = cell + pad * 2
    ch = header + cell + footer + pad
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new('RGB', (cw * cols, ch * rows), (222, 222, 228))
    d = ImageDraw.Draw(sheet)
    for k, (slot_id, cn, series, img) in enumerate(entries):
        col, row = k % cols, k // cols
        ox, oy = col * cw, row * ch
        d.rectangle([ox + 1, oy + 1, ox + cw - 2, oy + ch - 2],
                    fill=(238, 238, 242), outline=(140, 140, 148), width=2)
        d.text((ox + pad, oy + 8), cn, font=font_name, fill=(26, 26, 32))
        d.text((ox + pad, oy + 34), '%s · %s · %dx%d' % (slot_id, series, img.size[0], img.size[1]),
               font=font_small, fill=(96, 96, 106))
        w, h = img.size
        scale = max(1, int(cell // max(w, h)))
        big = img.resize((w * scale, h * scale), Image.NEAREST)
        bx = ox + pad + (cell - w * scale) // 2
        by = oy + header + (cell - h * scale) // 2
        d.rectangle([bx - 1, by - 1, bx + w * scale, by + h * scale], outline=(176, 176, 184))
        sheet.paste(big, (bx, by), big)
        fy = oy + header + cell + 6
        d.text((ox + pad, fy + 4), '1:1 实际大小 →', font=font_small, fill=(110, 110, 120))
        sheet.paste(img, (ox + pad + 118, fy), img)
        d.rectangle([ox + pad + 117, fy - 1, ox + pad + 118 + w, fy + h], outline=(176, 176, 184))
        d.text((ox + cw - pad - 96, fy + 4), '%d 倍放大' % scale, font=font_small, fill=(110, 110, 120))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return sheet.size


def check_passive_silhouette(images, verbose=True):
    """
    被动图标 v2 的核心判据：44px 显示尺寸下的剪影两两差异（Jaccard 距离，越大越好）。
      1) 24 个被动两两平均 ≥ SIL_AVG_MIN（0.45，原来 0.366 / 武器 0.443）
      2) 任意一对 ≥ SIL_PAIR_MIN（0.20，原来最差 0.121）
    另外打印：武器对照组、新旧对比、被动「十巫幡」vs 武器「十巫幡」的专项差异。
    返回 (problems, rows)。
    """
    problems = []
    rows = silhouette_rows(images, ICON_PASSIVE_IDS)
    if not rows:
        return ['被动图标剪影：一张都没取到'], rows
    worst = min(rows, key=lambda r: r[2])
    best = max(rows, key=lambda r: r[2])
    avg = float(np.mean([r[2] for r in rows]))
    print('-' * 78)
    print('【核心判据】44px 实际显示尺寸下的剪影差异（预乘 Lanczos 放大到 44×44，alpha>%d 当剪影，'
          'Jaccard 距离 = 1 - 交/并）' % SIL_THR)
    print('  · 24 个被动：%d 对；平均值 %.3f（下限 %.2f）' % (len(rows), avg, SIL_AVG_MIN))
    print('  · 最接近的一对（最危险）：%.3f  ← %s（%s）vs %s（%s）  下限 %.2f'
          % (worst[2], cn_of(worst[0]), worst[0], cn_of(worst[1]), worst[1], SIL_PAIR_MIN))
    print('  · 差别最大的一对：        %.3f  ← %s（%s）vs %s（%s）'
          % (best[2], cn_of(best[0]), best[0], cn_of(best[1]), best[1]))
    print('  · 最接近的五对（余量一目了然）：')
    for a, b, dv, _aa, _ab in sorted(rows, key=lambda r: r[2])[:5]:
        print('      %.3f  %s（%s）vs %s（%s，%s）' % (dv, cn_of(a), a, cn_of(b), b, ICON_SERIES.get(b, '-')))
    wr = silhouette_rows(images, ICON_WEAPON_IDS)
    wavg = float(np.mean([r[2] for r in wr])) if wr else float('nan')
    wworst = min(wr, key=lambda r: r[2]) if wr else None
    print('  · 对照组（武器 24 张，玩家说没问题）：平均 %.3f，最差 %.3f'
          % (wavg, wworst[2] if wworst else float('nan')))
    print('  · 新旧对比：被动平均 %.3f → %.3f（%+.3f）；最差一对 %.3f → %.3f（%+.3f）'
          % (SIL_BASELINE['passive_avg'], avg, avg - SIL_BASELINE['passive_avg'],
             SIL_BASELINE['passive_min'], worst[2], worst[2] - SIL_BASELINE['passive_min']))
    print('     （旧值用同一把尺子量在重画前的成品上：平均 %.3f、最差 %s = %.3f）'
          % (SIL_BASELINE['passive_avg'], SIL_BASELINE['passive_min_pair'], SIL_BASELINE['passive_min']))
    # 同名专项：被动十巫幡 vs 武器十巫幡
    if 'icon_passive_shiwufan' in images and 'icon_w_shiwu' in images:
        d = jaccard_sil(silhouette44(images['icon_passive_shiwufan']), silhouette44(images['icon_w_shiwu']))
        print('  · 专项：被动 icon_passive_shiwufan（十巫幡）vs 武器 icon_w_shiwu（十巫幡）→ 剪影差异 %.3f' % d)
    # 原有度量（像素差 / 灰度指纹 / 颜色直方图）不得退化：同口径打印被动组的极值
    prows = icon_pairs(images, ICON_PASSIVE_IDS)
    if prows:
        pmin, fmin, omax = gmin(prows, 'pix_diff'), gmin(prows, 'fp_diff'), gmax(prows, 'overlap')
        print('  · 原有度量（同组同口径，被动 24 张）：像素差最小 %.2f（重画前 22.07）、'
              '指纹差最小 %.1f（重画前 7.23）、直方图重叠最大 %.3f（重画前 0.813）'
              % (pmin[2]['pix_diff'], fmin[2]['fp_diff'], omax[2]['overlap']))
    if verbose:
        print('  逐张 44px 剪影面积（px²/1936，太小 = 缩到卡片上会糊成一团）：')
        for sid in ICON_PASSIVE_IDS:
            if sid in images:
                m = silhouette44(images[sid])
                bb = Image.fromarray((m * 255).astype(np.uint8)).getbbox()
                print('    %-28s %-6s 面积 %4d  (%4.1f%%)  剪影框 %s'
                      % (sid, cn_of(sid), int(m.sum()), 100.0 * m.sum() / (SIL_SIZE * SIL_SIZE),
                         '%dx%d' % (bb[2] - bb[0], bb[3] - bb[1]) if bb else '-'))
    if avg < SIL_AVG_MIN:
        problems.append('24 个被动的剪影两两平均差异 %.3f < %.2f（还是同一类图案）' % (avg, SIL_AVG_MIN))
    if worst[2] < SIL_PAIR_MIN:
        problems.append('最接近的一对 %s vs %s 剪影差异只有 %.3f < %.2f'
                        % (worst[0], worst[1], worst[2], SIL_PAIR_MIN))
    return problems, rows


def icon_color_report(images):
    """打印每个道具图标「平均色 vs 本系主色」的信息（不判失败，供人审配色是否跑偏）。"""
    print('%-26s %-6s %-9s %-9s %-8s %s' % ('槽位', '神系', '本系主色', '平均色', '色相差', '最近系'))
    worst = []
    for slot_id in ICON_WEAPON_IDS + ICON_PASSIVE_IDS + ICON_SPECIAL + ['icon_passive']:
        img = images.get(slot_id)
        series = ICON_SERIES.get(slot_id)
        if img is None or series is None or series not in SERIES_MAIN:
            continue
        want = hex_to_rgb(SERIES_MAIN[series])
        avg = avg_visible_color(img)
        if avg is None:
            continue
        ha, hw = hue_of(avg), hue_of(want)
        nearest = min(SERIES_MAIN, key=lambda k: hue_delta(ha, hue_of(hex_to_rgb(SERIES_MAIN[k]))))
        hd = hue_delta(ha, hw)
        worst.append((hd, slot_id, series))
        print('%-26s %-6s %-9s %-9s %-8s %s' % (slot_id, series, SERIES_MAIN[series], rgb_to_hex(avg),
                                                '%.1f°' % hd, nearest))
    if worst:
        worst.sort(reverse=True)
        top = worst[:3]
        print('  色相偏差最大的三个：' + '、'.join('%s %s %.1f°' % (s, i, h) for h, i, s in top)
              + '（图标里掺了骨白/暗色这类中性墨，平均色天然偏灰；这批的主色取自 series.js，未自创）')


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    if not os.path.exists(SHEET):
        print('[FAIL] 找不到网格图：%s' % SHEET)
        print('       先按 tools/sprites/sheet.html 顶部注释跑一次 Edge 无头截图。')
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ARTIFACTS, exist_ok=True)

    # 0) 顺序校验：sheet.html 的画稿顺序必须与 SLOTS 逐位一致（切片是按索引取格的）
    order_problems = check_sheet_order()

    sheet = Image.open(SHEET).convert('RGBA')
    expect_w = COLS * CELL
    expect_h = ((len(SLOTS) + COLS - 1) // COLS) * CELL
    if sheet.size[0] < expect_w or sheet.size[1] < expect_h:
        print('[FAIL] 网格图尺寸 %s 小于期望 %s（Edge 的 --window-size 是不是没跟着槽位数改？）'
              % (sheet.size, (expect_w, expect_h)))
        return 1
    if sheet.size != (expect_w, expect_h):
        # 窗口比画布大时（--window-size 取整、或槽位数变少）截图会多出透明边，裁掉即可
        print('网格图 %dx%d 比期望 %dx%d 大，按期望裁切左上角'
              % (sheet.size[0], sheet.size[1], expect_w, expect_h))
        sheet = sheet.crop((0, 0, expect_w, expect_h))
    print('网格图：%s  %dx%d' % (SHEET, sheet.size[0], sheet.size[1]))
    print('-' * 78)

    images = {}
    results = []
    for idx, (slot_id, cn, w, h, _batch) in enumerate(SLOTS):
        art = crop_art(sheet, idx)
        small = downscale_premultiplied(art, w, h)
        out_path = os.path.join(OUT_DIR, slot_id + '.png')
        small.save(out_path, 'PNG', optimize=True)
        images[slot_id] = small
        res = check_sprite(out_path, slot_id, cn, w, h)
        results.append((slot_id, cn, w, h, res, out_path))

    # 独特性（全局两两比较）
    distinct_problems, ratios = check_distinct(images)
    offenders = set()
    for p in distinct_problems:
        for sid in images:
            if p.startswith(sid + ' vs') or (' vs ' + sid) in p:
                offenders.add(sid)

    # ---- 报告 ----
    all_ok = True
    if order_problems:
        all_ok = False
    print('%-4s %-19s %-6s %-10s %-9s %-8s %s' %
          ('#', '槽位', '尺寸', '包围盒', '留白LTRB', '覆盖率', '结论'))
    for i, (slot_id, cn, w, h, res, out_path) in enumerate(results):
        info = res['info']
        size_s = '%dx%d' % info.get('size', (0, 0))
        if 'bbox' in info:
            bbox_s = '%d,%d-%d,%d' % info['bbox']
            marg_s = '%d/%d/%d/%d' % info['margins']
        else:
            bbox_s = marg_s = '-'
        cov = info.get('coverage', 0)
        bad = (not res['ok']) or (slot_id in offenders)
        if bad:
            all_ok = False
        print('%-4d %-19s %-6s %-10s %-9s %-8s %s' %
              (i + 1, slot_id, size_s, bbox_s, marg_s, cov, 'PASS' if not bad else 'FAIL'))

    print('-' * 78)

    # 逐张错误明细
    any_err = bool(order_problems)
    for slot_id, cn, w, h, res, out_path in results:
        if not res['ok']:
            any_err = True
            print('[FAIL] %s（%s）' % (slot_id, cn))
            for e in res['errors']:
                print('       - %s' % e)
    if not any_err:
        print('逐张检查：%d/%d 全部通过'
              '（尺寸精确、非空、包围盒居中≤%.0f%%、四角 alpha=0、四周不贴边）'
              % (len(SLOTS), len(SLOTS), CENTER_TOL * 100))

    # 独特性明细：打印最小差异 / 最大重叠的那一对，作为"辨识度余量"的证据
    if ratios:
        worst = min(ratios, key=lambda r: r[2])
        most = max(ratios, key=lambda r: r[3])
        print('独特性：%d 对两两比较；最接近的一对 %s vs %s → 像素差 %.2f、直方图重叠 %.3f'
              % (len(ratios), worst[0], worst[1], worst[2], worst[3]))
        print('        直方图最重叠的一对 %s vs %s → 重叠 %.3f、像素差 %.2f'
              % (most[0], most[1], most[3], most[2]))
        if distinct_problems:
            any_err = True
            print('[FAIL] 有槽位长得太像：')
            for p in distinct_problems:
                print('       - %s' % p)
        else:
            print('        结论：无雷同（全部 %d 对差异明显）' % len(ratios))

    # ---- 主色检查：角色槽位的平均色必须最像本系主色 ----
    print('-' * 78)
    print('主色检查（非透明像素平均色 vs 本系主色）：')
    print('%-18s %-6s %-9s %-9s %-8s %-7s %-7s %s' %
          ('槽位', '所属系', '主色', '平均色', '色相差', '饱和度', '最近系', '结论'))
    color_results = {}
    for slot_id in CHARS6:
        if slot_id not in images:
            continue
        cr = check_main_color(slot_id, images[slot_id])
        color_results[slot_id] = cr
        inf = cr['info']
        if not cr['ok']:
            any_err = True
            all_ok = False
        print('%-18s %-6s %-9s %-9s %-8s %-7s %-7s %s' %
              (slot_id, inf['series'], inf['want'], inf.get('avg', '-'),
               '%.1f°' % inf.get('hue_delta', 0), '%.3f' % inf.get('sat', 0),
               inf.get('nearest', '-'), 'PASS' if cr['ok'] else 'FAIL'))
        for e in cr['errors']:
            print('       - %s' % e)
    print('       （判据：色相偏差 ≤ %.0f° + 六个系里色相最近的是本系 + 饱和度 ≥ 下限；'
          '平均色天然比主色暗，因为图上还有深色描边与暗部）' % HUE_TOL)

    # ---- 六角色两两对照 ----
    print('-' * 78)
    chars6_problems, chars6_rows = check_chars6(images)
    if chars6_rows:
        w_fp = min(chars6_rows, key=lambda r: r[2]['fp_diff'])
        w_px = min(chars6_rows, key=lambda r: r[2]['pix_diff'])
        w_ov = max(chars6_rows, key=lambda r: r[2]['overlap'])
        print('六角色两两对照：%d 对（6×5/2）' % len(chars6_rows))
        print('  最相似（灰度指纹）  %s vs %s → 指纹差 %.1f（阈值 >%.1f）'
              % (w_fp[0], w_fp[1], w_fp[2]['fp_diff'], FP_MIN))
        print('  最相似（像素差）    %s vs %s → 像素差 %.2f（阈值 >%.0f）'
              % (w_px[0], w_px[1], w_px[2]['pix_diff'], PIX_MIN))
        print('  最相似（颜色直方图）%s vs %s → 重叠 %.3f（阈值 <%.2f）'
              % (w_ov[0], w_ov[1], w_ov[2]['overlap'], HIST_MAX))
        if chars6_problems:
            any_err = True
            all_ok = False
            print('[FAIL] 六个角色里有长得太像的：')
            for p in chars6_problems:
                print('       - %s' % p)
        else:
            print('  结论：六张两两都可区分（%d 对全部达标）' % len(chars6_rows))

    # ---- 批 3 道具图标：两两不撞脸（三度量互相印证）----
    print('-' * 78)
    icon_problems = []
    ip48, _ = check_icon_group(images, ICON_48, '道具图标 24 武器 + 24 被动（48 张互相比较）')
    icon_problems += ip48
    ip49, _ = check_icon_group(images, ICON_49, '再加上通用被动 icon_passive（49 张同框）')
    icon_problems += ip49
    ip_super, _ = check_icon_group(images, ['icon_super'] + ICON_49,
                                   '超武 icon_super vs 全部 49 个道具图标（它会在同一个格子里相邻出现）')
    icon_problems += ip_super
    ip_all, _ = check_icon_group(images, ICON_WEAPON_IDS + ICON_PASSIVE_IDS + ['icon_passive', 'icon_super', 'icon_drop'],
                                 '全部 51 张道具图标（含 icon_drop）')
    icon_problems += ip_all
    if icon_problems:
        any_err = True
        all_ok = False
        print('[FAIL] 道具图标里有撞脸的：共 %d 对' % len(icon_problems))
    # ---- 被动图标 v2 的核心判据：44px 下的剪影两两差异 ----
    sil_problems, sil_rows = check_passive_silhouette(images)
    if sil_problems:
        any_err = True
        all_ok = False
        print('[FAIL] 被动图标剪影差异不达标：')
        for p in sil_problems:
            print('       - %s' % p)
    else:
        print('  结论：24 个被动全部达标（平均 %.3f ≥ %.2f，最差一对 %.3f ≥ %.2f）'
              % (float(np.mean([r[2] for r in sil_rows])), SIL_AVG_MIN,
                 min(r[2] for r in sil_rows), SIL_PAIR_MIN))
    # 配色信息（不判失败）
    print('-' * 78)
    print('道具图标配色信息（主色取自 src/content/series.js，不自创）：')
    icon_color_report(images)

    # 联络表
    pairs = [(slot_id, cn, w, h, images[slot_id]) for slot_id, cn, w, h, _res, _p in results]
    size = build_contact_sheet(pairs, CONTACT, scale=4)
    # 放大预览（8 倍，脱敏到内容框）：小精灵在 4 倍下仍看不清器官，审图时看这张
    zoom_pairs = []
    for slot_id, cn, w, h, img in pairs:
        bb = img.getbbox() or (0, 0, w, h)
        zoom_pairs.append((slot_id, cn, bb[2] - bb[0], bb[3] - bb[1], img.crop(bb)))
    build_contact_sheet(zoom_pairs, CONTACT_ZOOM, scale=8, pad=22, header=44)
    # 六角色对照图（浅灰底、288px/格、带名字）
    chars6_size = build_chars6(images, CHARS6_SHEET, scale=9)
    # 道具图标联络表 ×3（任务书指定的三个文件）
    def ico_entries(ids):
        return [(i, cn_of(i), ICON_SERIES.get(i, '-'), images[i]) for i in ids if i in images]
    sz_w = build_icon_sheet(ico_entries(ICON_WEAPON_IDS), ICONS_WEAPONS_SHEET, cols=4)
    sz_p = build_icon_sheet(ico_entries(ICON_PASSIVE_IDS + ['icon_passive']), ICONS_PASSIVES_SHEET, cols=4)
    sz_s = build_icon_sheet(ico_entries(['icon_super', 'icon_drop']), ICONS_SPECIAL_SHEET, cols=2)
    # 被动图标 v2 的两张联络表（24 个被动，不含通用兜底 icon_passive）
    sz_p2 = build_icon_sheet(ico_entries(ICON_PASSIVE_IDS), ICONS_PASSIVES_V2_SHEET, cols=4)
    sz_p44 = build_passive_44_sheet(ico_entries(ICON_PASSIVE_IDS), ICONS_PASSIVES_V2_44)
    print('-' * 78)
    print('成品目录：%s' % OUT_DIR)
    print('联络表：  %s  (%dx%d，4 倍放大 + 槽位名)' % (CONTACT, size[0], size[1]))
    print('放大预览：%s  (8 倍，供看器官轮廓)' % CONTACT_ZOOM)
    print('六角色对照图：%s  (%dx%d，浅灰底 + 名字，288px/格)'
          % (CHARS6_SHEET, chars6_size[0], chars6_size[1]))
    print('武器图标联络表：%s  (%dx%d)' % (ICONS_WEAPONS_SHEET, sz_w[0], sz_w[1]))
    print('被动图标联络表：%s  (%dx%d)' % (ICONS_PASSIVES_SHEET, sz_p[0], sz_p[1]))
    print('特殊图标联络表：%s  (%dx%d)' % (ICONS_SPECIAL_SHEET, sz_s[0], sz_s[1]))
    print('被动图标 v2 联络表：%s  (%dx%d，24 个，10 倍放大 + 名字)' % (ICONS_PASSIVES_V2_SHEET, sz_p2[0], sz_p2[1]))
    print('被动图标 v2 · 44px 判据图：%s  (%dx%d，1:1 实际显示尺寸 + 底部整行平铺)'
          % (ICONS_PASSIVES_V2_44, sz_p44[0], sz_p44[1]))
    print('-' * 78)
    print('总判定：%s' % ('PASS —— %d 张全部通过自检' % len(SLOTS) if all_ok and not any_err else 'FAIL'))

    # 机器可读的汇总（给上游脚本/审查用）
    with io.open(CHECK_TXT, 'w', encoding='utf-8') as f:
        for slot_id, cn, w, h, res, out_path in results:
            f.write('%s %dx%d %s %s\n' % (slot_id, w, h, 'PASS' if res['ok'] and slot_id not in offenders else 'FAIL',
                                          '; '.join(res['errors'])))
        f.write('distinct_pairs=%d problems=%d\n' % (len(ratios), len(distinct_problems)))
        for slot_id in CHARS6:
            cr = color_results.get(slot_id)
            if cr:
                f.write('color %s %s series=%s hue_delta=%.1f %s\n'
                        % (slot_id, cr['info'].get('avg', '-'), cr['info']['series'],
                           cr['info'].get('hue_delta', 0), 'PASS' if cr['ok'] else 'FAIL'))
        f.write('chars6_pairs=%d problems=%d\n' % (len(chars6_rows), len(chars6_problems)))
        f.write('icons48_pairs=%d icons49_pairs=%d problems=%d\n'
                % (len(ICON_48) * (len(ICON_48) - 1) // 2, len(ICON_49) * (len(ICON_49) - 1) // 2, len(icon_problems)))
        if sil_rows:
            _w = min(sil_rows, key=lambda r: r[2])
            f.write('silhouette44 size=%d thr=%d pairs=%d avg=%.3f min=%.3f (%s vs %s) problems=%d\n'
                    % (SIL_SIZE, SIL_THR, len(sil_rows), float(np.mean([r[2] for r in sil_rows])),
                       _w[2], _w[0], _w[1], len(sil_problems)))
    print('自检明细：%s' % CHECK_TXT)

    return 0 if (all_ok and not any_err) else 1


if __name__ == '__main__':
    sys.exit(main())
