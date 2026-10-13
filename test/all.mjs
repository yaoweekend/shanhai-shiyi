// 一键跑完全部测试：node test/all.mjs [--quick]
// 顺序：静态自检 → 渲染自检 → 局外进度 → 无头冒烟与平衡
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const quick = process.argv.includes('--quick');
const suites = [
  ['静态自检（模块/DOM/内容表/不联网）', ['tools/check.mjs']],
  ['槽位命名一致性（清单 ↔ 生产代码）', ['tools/verify-icon-slots.mjs']],
  ['编码体检（UTF-8 / 乱码 / 控制字符）', ['test/encoding.mjs']],
  ['渲染自检（stub Canvas 2D）', ['test/render.mjs']],
  ['触碰伤害回归（radius NaN 曾整条失效）', ['test/contact-damage.mjs']],
  ['平衡回归（经验值/槽位/通道全局生效/强度上限）', ['test/balance.mjs']],
  ['新机制回归（领域/蓄力/标记/终极融合/六系可跑）', ['test/new-mechanics.mjs']],
  ['批 1 改判验收（六个操作型主动技 / 裂地潮汐天罚轮转 / 解锁链 / HUD / 术语）', ['test/batch1-rework.mjs']],
  ['批 2 改判验收（十日凌空 / 百巫夜行 / 昆仑永镇 / 六机制两两不同 / 性能）', ['test/batch2-rework.mjs']],
  ['平衡修订验收（六系清场当量齐平 / 蛊爆 / 诅咒 / 以守为攻 / CD）', ['test/balance-rework.mjs']],
  ['调参面板验收（正式包守门 / 不写存档 / 预设 / 时间缩放 / 配置串）', ['test/dev-tune.mjs']],
  ['武器视觉自检（24 把不许撞脸）', ['test/weapon-visuals.mjs']],
  ['精灵素材验收（真图尺寸/透明/居中/不撞脸）', ['test/sprites.mjs']],
  ['卡池解锁门禁（未解锁的系不能出现）', ['test/unlock-gating.mjs']],
  ['UI 自检（暂停道具清单/合成高亮）', ['test/ui-loadout.mjs']],
  ['局外进度（试炼/解锁/存档迁移）', ['test/meta.mjs']],
  ['批 1 验收集成（内容矩阵/Boss 三阶段/精英/无尽/续局）', ['test/accept.mjs']],
  ['无头冒烟与平衡', ['test/headless.mjs', ...(quick ? ['--quick'] : [])]],
];

let failed = 0;
for (const [name, args] of suites) {
  console.log(`\n████ ${name} ████`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n████ 汇总：${suites.length - failed}/${suites.length} 个套件通过 ████`);
process.exit(failed === 0 ? 0 : 1);
