// 真机资源自检（只在 `?dev=diag` / `?dev=ultimate` 时被 main.js 调用）。
//
// 存在的理由：渲染层对敌人/角色/道具都是"取到图就画图，取不到就画一个色块圆"，
// 所以**素材加载失败的表现是"怪物变成红圆圈"**，而不是报错。这种失败在桌面上
// 复现不出来（Node 里没有真实图片加载），只能在真机上量。
//
// 这里做两件事（**不发任何网络请求**，遵守严格不联网约束）：
//   ① 主动调 getAsset 触发加载并等它解码完；
//   ② 读运行时加载状态机，报告 ready / failed，并逐个列出失败项。
import { assetState, getAsset } from './generator.js';
import { SLOTS, FUTURE_SLOTS } from './manifest.js';

const withFile = [...SLOTS, ...FUTURE_SLOTS].filter((s) => s.file);

export async function runAssetDiagnostics(log = console.log) {
  // 主动触发加载：getAsset 会为每个槽位创建 Image 并开始解码。
  for (const s of withFile) getAsset(s.id);

  // 给图片足够时间解码（最多轮询 5 秒），再读最终状态。
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pending = withFile.filter((s) => {
      const st = assetState(s.id);
      return st === 'loading' || st === 'not-requested';
    });
    if (pending.length === 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const states = {};
  const failed = [];
  for (const s of withFile) {
    const st = assetState(s.id);
    states[st] = (states[st] || 0) + 1;
    if (st === 'failed') failed.push(s.id);
  }
  log(`[资源诊断] ${withFile.length} 个文件 → ${Object.entries(states).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  if (failed.length) {
    log(`[资源诊断] 解码失败 ${failed.length} 个：${failed.slice(0, 20).join(', ')}${failed.length > 20 ? ' …' : ''}`);
  } else {
    log('[资源诊断] 全部解码成功 ✓');
  }
  return { states, failed };
}
