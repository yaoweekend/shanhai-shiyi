#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
山海拾遗 · manifest 登记脚本（只加 file 字段，别的什么都不动）
================================================================

用法
----
    python tools/sprites/apply_manifest.py            # 干跑：只打印将要做的改动
    python tools/sprites/apply_manifest.py --write    # 真的写回 src/assets/manifest.js

为什么用脚本而不是手改：
  · 硬约束是「只加 file 字段，不改槽位顺序/id/尺寸/generator，也不删既有字段
    （batch: 2/3/4 之类）」——正则只在指定槽位的那一行、紧跟 generator 之后插入，
    并校验"槽位定义行数不变"；
  · 每批新图标只要改下面的 BATCH 列表就能复用。

两条插入路径（批 3 起两条都要走）：
  ① **逐行登记的槽位**（SLOTS 里有字面量行的，例如 icon_w_shoujia / icon_super）：
     行里已有 `...SELF_DRAWN` → 只补 `, file: '...'`；没有的 → 补
     `, ...SELF_DRAWN, file: '...'`（免得出现"有 file 但答不出这张图哪来的"）。
  ② **从 WEAPONS / PASSIVES 派生的槽位**（39 个：15 个 icon_w_* + 24 个 icon_passive_*）：
     它们在 manifest.js 里没有字面量行，是代码生成的，所以要改的是派生逻辑本身 ——
     脚本把 BATCH 里"没有字面量行"的 id 补进 manifest.js 的 SELF_DRAWN_ICON_IDS 集合；
     派生循环里再按 assets/sprites/<槽位id>.png 补 file。
     没有这一步，24 把武器的图标会全部回退到同一个四角星占位图。

许可/来源/日期是规格 §12 的必填项：file 的取值就是 `assets/sprites/<槽位id>.png`
（相对 index.html 的 URL）。
"""

import io
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MANIFEST = os.path.join(ROOT, 'src', 'assets', 'manifest.js')

# 本批要登记的槽位（与 slice.py 的 SLOTS 一致）
BATCH = [
    # 批 1（9 张：逐行登记）
    'char_shanpo', 'char_haipo', 'char_huangpo',
    'enemy_shanxiao', 'enemy_bifang', 'enemy_huashe', 'enemy_xinang', 'enemy_qiangliang',
    'boss_xiangliu',
    # 批 2（3 张：第 4~6 系玩家角色，定义在 FUTURE_SLOTS 里）
    'char_tianpo', 'char_wupo', 'char_busipo',
    # 批 3（51 张：道具图标）
    #   逐行登记的 12 个（走路径 ①）
    'icon_w_shoujia', 'icon_w_guhai', 'icon_w_lizhao',
    'icon_w_linyu', 'icon_w_jiaozhu', 'icon_w_jingxi',
    'icon_w_huanglei', 'icon_w_zhangqi', 'icon_w_zhaoyin',
    'icon_passive', 'icon_super', 'icon_drop',
    #   由 WEAPONS / PASSIVES 派生的 39 个（走路径 ②）
    'icon_w_shanbeng', 'icon_w_haimao', 'icon_w_dahuangfeng',
    'icon_w_rijian', 'icon_w_jiguang', 'icon_w_riyue', 'icon_w_tianji',
    'icon_w_wugu', 'icon_w_shigu', 'icon_w_shiwu', 'icon_w_lingwu',
    'icon_w_kunlun_1', 'icon_w_kunlun_2', 'icon_w_kunlun_3', 'icon_w_kunlun_4',
    'icon_passive_xuangui', 'icon_passive_kuiniu', 'icon_passive_shanyueji', 'icon_passive_dangkangya',
    'icon_passive_jiuweiyi', 'icon_passive_kunpengyi', 'icon_passive_shenglouzhu', 'icon_passive_jiaorenyan',
    'icon_passive_zhulongtong', 'icon_passive_zhurongjin', 'icon_passive_qiongqixiu', 'icon_passive_bashetun',
    'icon_passive_houyigong', 'icon_passive_kuafuzhong', 'icon_passive_nvwashi', 'icon_passive_jingweiwei',
    'icon_passive_wuxianfu', 'icon_passive_gumumin', 'icon_passive_lingshanwu', 'icon_passive_shiwufan',
    'icon_passive_busiyao', 'icon_passive_xuanpuzhi', 'icon_passive_kunlunyu', 'icon_passive_luwushou',
]

SLOT_LINE = re.compile(r"^(\s*\{\s*id:\s*'([a-z0-9_]+)'.*?)(,?\s*)\}\s*,\s*$")
ICON_SET_BLOCK = re.compile(r"(const SELF_DRAWN_ICON_IDS = new Set\(\[)(.*?)(\]\);)", re.S)


def patch_slot_lines(lines, changed):
    """路径 ①：逐行登记的槽位，在 generator 之后插入 ...SELF_DRAWN / file。"""
    for i, line in enumerate(lines):
        m = SLOT_LINE.match(line)
        if not m:
            continue
        slot_id = m.group(2)
        if slot_id not in BATCH:
            continue
        if 'file:' in line:
            print('  跳过 %s（已经有 file 字段）' % slot_id)
            continue
        extra = ", file: 'assets/sprites/%s.png'" % slot_id
        if 'SELF_DRAWN' not in line:
            extra = ", ...SELF_DRAWN" + extra
        new_line = re.sub(r"(generator:\s*'[^']*')", r"\1" + extra.replace('\\', '\\\\'), line)
        if new_line == line:
            print('  [WARN] %s 找不到 generator 字段，未改动' % slot_id)
            continue
        lines[i] = new_line
        changed.append(slot_id)


def patch_icon_set(text, derived_ids):
    """路径 ②：把派生槽位的 id 补进 manifest.js 的 SELF_DRAWN_ICON_IDS 集合。"""
    m = ICON_SET_BLOCK.search(text)
    if not m:
        print('  [WARN] manifest.js 里找不到 SELF_DRAWN_ICON_IDS 块，派生槽位未补 file')
        return text, []
    have = set(re.findall(r"'([a-z0-9_]+)'", m.group(2)))
    missing = sorted(set(derived_ids) - have)
    if not missing:
        print('  派生槽位：SELF_DRAWN_ICON_IDS 已包含全部 %d 个 id（无需改动）' % len(derived_ids))
        return text, []
    print('  派生槽位：往 SELF_DRAWN_ICON_IDS 追加 %d 个 id：%s' % (len(missing), ', '.join(missing)))
    body = ''.join('\n  %s,' % ("'%s'" % i) for i in sorted(have | set(missing)))
    return text[:m.start(2)] + body + '\n' + text[m.end(2):], missing


def apply(write=False):
    with io.open(MANIFEST, 'r', encoding='utf-8') as f:
        text = f.read()
    lines = text.split('\n')
    slot_lines_before = sum(1 for ln in lines if SLOT_LINE.match(ln))

    changed = []
    patch_slot_lines(lines, changed)
    out = '\n'.join(lines)

    # 哪些 BATCH 里的 id 在 manifest 里没有字面量行 → 它们只能走派生路径
    literal = set()
    for ln in lines:
        m = SLOT_LINE.match(ln)
        if m:
            literal.add(m.group(2))
    derived_ids = [s for s in BATCH if s not in literal]
    out, added = patch_icon_set(out, derived_ids)

    only_line = ', '.join(changed) if changed else '(无)'
    print('逐行登记 %d 个槽位：%s' % (len(changed), only_line))
    if not write:
        for slot_id in changed:
            for line in out.split('\n'):
                if "'%s'" % slot_id in line:
                    print('  ' + line.strip())
                    break
        print('（干跑模式；加 --write 才真正写回）')
        return 0

    slot_lines_after = sum(1 for ln in out.split('\n') if SLOT_LINE.match(ln))
    if slot_lines_after != slot_lines_before:
        print('[FAIL] 槽位定义行数从 %d 变成 %d，拒绝写入' % (slot_lines_before, slot_lines_after))
        return 1
    if out == text:
        print('manifest.js 无需改动')
        return 0
    with io.open(MANIFEST, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('已写入 %s（逐行 +%d，派生集合 +%d）' % (MANIFEST, len(changed), len(added)))
    return 0


if __name__ == '__main__':
    sys.exit(apply(write='--write' in sys.argv))
