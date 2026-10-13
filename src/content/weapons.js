// 9 把武器（规格 §4 内容矩阵 ×3 系）+ 每把 5 级成长。
// 每把武器是一条"开火行为"（kind）+ 一张等级成长表（levels）。
// 数值全部是数据：改平衡不需要动逻辑。

export const WEAPONS = [
  // ================= 山经 · 兽 =================
  {
    id: 'w_shoujia',
    cn: '兽甲旋刃',
    series: 'shan',
    slot: 1,
    kind: 'orbit',
    unlock: 'initial',
    icon: 'ring-blade',
    blurb: '环绕本体旋转的甲刃，不创建投射物实体（角函数）。',
    levels: [
      // 近战武器必须"更快清掉贴身的怪"，否则在高密度下只会被持续磨血。
      // 伤害偏高的第二个原因：环绕刃每转一圈对**单个**目标只能结算 1–2 次
      // （命中窗口由角速度决定，与目标大小无关），所以对 Boss 这种巨物
      // 它天然吃亏，只能靠单次伤害补回来（实测相柳 150s 死线需要 ≈173 DPS）。
      { damage: 30, count: 1, radius: 82, cd: 0.5, size: 30, knockback: 150 },
      { damage: 44, count: 2, radius: 85, cd: 0.5, size: 32, knockback: 165 },
      { damage: 60, count: 3, radius: 89, cd: 0.5, size: 34, knockback: 190 },
      { damage: 78, count: 4, radius: 93, cd: 0.5, size: 37, knockback: 215 },
      { damage: 100, count: 5, radius: 98, cd: 0.5, size: 40, knockback: 260 },
    ],
  },
  {
    id: 'w_guhai',
    cn: '骨骸回旋',
    series: 'shan',
    slot: 2,
    kind: 'boomerang',
    unlock: 'pool',
    icon: 'boomerang',
    blurb: '沿弧线掷出并返回，全程穿透。',
    levels: [
      { damage: 14, count: 1, cd: 1.5, speed: 380, range: 240, size: 12, width: 30 },
      { damage: 18, count: 1, cd: 1.4, speed: 400, range: 270, size: 13, width: 33 },
      { damage: 24, count: 1, cd: 1.3, speed: 420, range: 300, size: 14, width: 36 },
      { damage: 31, count: 2, cd: 1.2, speed: 440, range: 330, size: 16, width: 40 },
      { damage: 40, count: 2, cd: 1.05, speed: 470, range: 370, size: 18, width: 46 },
    ],
  },
  {
    id: 'w_lizhao',
    cn: '利爪横扫',
    series: 'shan',
    slot: 3,
    kind: 'sweep',
    unlock: 'pool',
    icon: 'claw',
    blurb: '近身扇形横扫，带击退。',
    levels: [
      { damage: 20, count: 1, cd: 1.1, radius: 96, arc: 110, knockback: 300 },
      { damage: 26, count: 1, cd: 1.0, radius: 108, arc: 120, knockback: 340 },
      { damage: 34, count: 1, cd: 0.95, radius: 120, arc: 130, knockback: 380 },
      { damage: 44, count: 1, cd: 0.9, radius: 134, arc: 145, knockback: 430 },
      { damage: 58, count: 2, cd: 0.8, radius: 150, arc: 160, knockback: 500 },
    ],
  },
  // ================= 海经 · 水 =================
  {
    id: 'w_linyu',
    cn: '鳞雨散射',
    series: 'hai',
    slot: 1,
    kind: 'projectile',
    unlock: 'initial',
    icon: 'scale-fan',
    pattern: 'fan',
    blurb: '扇形 3 发鳞片。',
    levels: [
      { damage: 8, count: 3, cd: 0.62, speed: 430, size: 7, spread: 18 },
      { damage: 10, count: 4, cd: 0.58, speed: 445, size: 7, spread: 20 },
      { damage: 13, count: 5, cd: 0.54, speed: 460, size: 8, spread: 22 },
      { damage: 17, count: 6, cd: 0.5, speed: 475, size: 8, spread: 24 },
      { damage: 22, count: 7, cd: 0.45, speed: 490, size: 9, spread: 26 },
    ],
  },
  {
    id: 'w_jiaozhu',
    cn: '鲛珠追踪',
    series: 'hai',
    slot: 2,
    kind: 'projectile',
    unlock: 'pool',
    icon: 'pearl',
    pattern: 'aimed',
    homing: 5.5,
    splash: 34,
    blurb: '自动寻敌，命中后小范围溅射。',
    levels: [
      { damage: 11, count: 1, cd: 1.0, speed: 360, size: 8, splash: 34 },
      { damage: 14, count: 1, cd: 0.92, speed: 380, size: 8, splash: 38 },
      { damage: 18, count: 2, cd: 0.86, speed: 400, size: 9, splash: 42 },
      { damage: 24, count: 2, cd: 0.78, speed: 420, size: 10, splash: 46 },
      { damage: 31, count: 3, cd: 0.68, speed: 445, size: 11, splash: 52 },
    ],
  },
  {
    id: 'w_jingxi',
    cn: '鲸息贯穿',
    series: 'hai',
    slot: 3,
    kind: 'beam',
    unlock: 'pool',
    icon: 'beam',
    blurb: '持续约 0.3 秒的直线光束，全穿透。',
    levels: [
      { damage: 10, cd: 1.6, duration: 0.3, width: 24, length: 560 },
      { damage: 13, cd: 1.5, duration: 0.32, width: 28, length: 600 },
      { damage: 17, cd: 1.4, duration: 0.34, width: 32, length: 650 },
      { damage: 22, cd: 1.3, duration: 0.36, width: 37, length: 700 },
      { damage: 29, cd: 1.15, duration: 0.4, width: 44, length: 780 },
    ],
  },
  // ================= 大荒经 · 荒 =================
  {
    id: 'w_huanglei',
    cn: '荒雷落顶',
    series: 'huang',
    slot: 1,
    kind: 'strike',
    unlock: 'initial',
    icon: 'bolt',
    blurb: '预警圈 + 定点落雷。',
    levels: [
      { damage: 16, count: 1, cd: 1.5, radius: 44, delay: 0.5 },
      { damage: 21, count: 1, cd: 1.4, radius: 48, delay: 0.48 },
      { damage: 27, count: 2, cd: 1.3, radius: 52, delay: 0.46 },
      { damage: 35, count: 3, cd: 1.2, radius: 57, delay: 0.44 },
      { damage: 46, count: 4, cd: 1.05, radius: 64, delay: 0.4 },
    ],
  },
  {
    id: 'w_zhangqi',
    cn: '瘴气毒雾',
    series: 'huang',
    slot: 2,
    kind: 'zone',
    unlock: 'pool',
    icon: 'mist',
    blurb: '在敌人脚下留下持续伤害区域。',
    levels: [
      { damage: 4, count: 1, cd: 2.2, radius: 58, duration: 3.2, delay: 0.7 },
      { damage: 5, count: 1, cd: 2.0, radius: 64, duration: 3.6, delay: 0.65 },
      { damage: 7, count: 2, cd: 1.9, radius: 70, duration: 4.0, delay: 0.6 },
      { damage: 9, count: 2, cd: 1.7, radius: 78, duration: 4.6, delay: 0.55 },
      { damage: 12, count: 3, cd: 1.5, radius: 88, duration: 5.2, delay: 0.5 },
    ],
  },
  {
    id: 'w_zhaoyin',
    cn: '召引荒兽',
    series: 'huang',
    slot: 3,
    kind: 'summon',
    unlock: 'pool',
    icon: 'beast',
    blurb: '自动追击的召唤物。',
    levels: [
      { damage: 10, count: 1, cd: 5.0, hp: 34, speed: 165, life: 9 },
      { damage: 13, count: 1, cd: 4.4, hp: 44, speed: 170, life: 10 },
      { damage: 17, count: 2, cd: 4.0, hp: 56, speed: 175, life: 11 },
      { damage: 22, count: 2, cd: 3.4, hp: 72, speed: 180, life: 12 },
      { damage: 29, count: 3, cd: 2.8, hp: 92, speed: 190, life: 14 },
    ],
  },
  {
    id: 'w_shanbeng',
    cn: '山崩践踏',
    series: 'shan',
    slot: 4,
    kind: 'aura',
    unlock: 'trial',
    icon: 'stomp',
    blurb: '以体魄震地，身周形成持续挤压的冲击场。',
    levels: [
      { dps: 16, radius: 86, tick: 0.5 },
      { dps: 22, radius: 94, tick: 0.5 },
      { dps: 30, radius: 102, tick: 0.46 },
      { dps: 40, radius: 112, tick: 0.42 },
      { dps: 54, radius: 124, tick: 0.38 },
    ],
  },

  // ================= 海经 · 水 =================
  {
    id: 'w_haimao',
    cn: '海茅穿刺',
    series: 'hai',
    slot: 4,
    kind: 'sweep',
    unlock: 'trial',
    icon: 'trident',
    blurb: '凝聚水茅向前突刺，一条线上的敌人全部贯穿。',
    levels: [
      { damage: 26, count: 1, cd: 1.0, radius: 150, arc: 34, knockback: 140 },
      { damage: 34, count: 1, cd: 0.94, radius: 165, arc: 36, knockback: 160 },
      { damage: 44, count: 1, cd: 0.88, radius: 180, arc: 38, knockback: 180 },
      { damage: 57, count: 1, cd: 0.8, radius: 198, arc: 40, knockback: 210 },
      { damage: 74, count: 2, cd: 0.72, radius: 218, arc: 42, knockback: 250 },
    ],
  },

  // ================= 大荒经 · 荒 =================
  {
    id: 'w_dahuangfeng',
    cn: '大荒风眼',
    series: 'huang',
    slot: 4,
    kind: 'zone',
    unlock: 'trial',
    icon: 'cyclone',
    blurb: '在原地卷起风暴，持续撕扯并牵引周围的敌人。',
    levels: [
      { damage: 6, count: 1, cd: 2.6, radius: 74, duration: 3.4, delay: 0.5, pull: 90 },
      { damage: 8, count: 1, cd: 2.4, radius: 81, duration: 3.8, delay: 0.46, pull: 110 },
      { damage: 10, count: 2, cd: 2.2, radius: 88, duration: 4.2, delay: 0.42, pull: 130 },
      { damage: 14, count: 2, cd: 2.0, radius: 97, duration: 4.8, delay: 0.38, pull: 155 },
      { damage: 18, count: 3, cd: 1.8, radius: 108, duration: 5.4, delay: 0.34, pull: 185 },
    ],
  },

  // ================= 天问 · 神祇（第 4 系）=================
  // 定位：爆发 · 暴击。新机制原型只有"蓄力穿透"（蓄力后打出贯穿全场的重击）。
  {
    id: 'w_rijian',
    cn: '日珥箭',
    series: 'tian',
    slot: 1,
    kind: 'projectile',
    unlock: 'initial',
    icon: 'arrow',
    pattern: 'aimed',
    blurb: '灼热的长箭，暴击时爆开。',
    levels: [
      { damage: 15, count: 1, cd: 0.9, speed: 520, size: 8 },
      { damage: 20, count: 1, cd: 0.84, speed: 540, size: 9 },
      { damage: 26, count: 2, cd: 0.78, speed: 560, size: 10 },
      { damage: 34, count: 2, cd: 0.7, speed: 580, size: 11 },
      { damage: 44, count: 3, cd: 0.62, speed: 610, size: 12 },
    ],
  },
  {
    id: 'w_jiguang',
    cn: '极光追魂',
    series: 'tian',
    slot: 2,
    kind: 'projectile',
    unlock: 'pool',
    icon: 'comet',
    pattern: 'fan',
    blurb: '高速分裂的极光碎片，自动咬住目标。',
    levels: [
      { damage: 9, count: 3, cd: 0.7, speed: 470, size: 7, spread: 26 },
      { damage: 12, count: 4, cd: 0.66, speed: 485, size: 7, spread: 28 },
      { damage: 15, count: 5, cd: 0.62, speed: 500, size: 8, spread: 30 },
      { damage: 19, count: 6, cd: 0.56, speed: 520, size: 8, spread: 32 },
      { damage: 25, count: 8, cd: 0.5, speed: 545, size: 9, spread: 34 },
    ],
  },
  {
    id: 'w_riyue',
    cn: '日月双环',
    series: 'tian',
    slot: 3,
    kind: 'aura',
    unlock: 'pool',
    icon: 'halo',
    blurb: '身周常驻的灼光场，持续烧灼靠近的一切。',
    levels: [
      { dps: 14, radius: 88, tick: 0.5 },
      { dps: 20, radius: 96, tick: 0.5 },
      { dps: 28, radius: 104, tick: 0.46 },
      { dps: 38, radius: 114, tick: 0.42 },
      { dps: 52, radius: 126, tick: 0.38 },
    ],
  },
  {
    id: 'w_tianji',
    cn: '天极贯日',
    series: 'tian',
    slot: 4,
    kind: 'charge',
    unlock: 'trial',
    icon: 'spear',
    blurb: '蓄力后射出一道贯穿全场的重击（新机制原型）。',
    levels: [
      { damage: 55, cd: 2.8, charge: 1.0, width: 30, length: 1200 },
      { damage: 72, cd: 2.6, charge: 0.95, width: 34, length: 1300 },
      { damage: 94, cd: 2.4, charge: 0.9, width: 38, length: 1400 },
      { damage: 122, cd: 2.2, charge: 0.85, width: 43, length: 1500 },
      { damage: 160, cd: 2.0, charge: 0.8, width: 50, length: 1650 },
    ],
  },

  // ================= 灵山 · 巫祝（第 5 系）=================
  // 定位：诅咒 · 减益 · 召唤。新机制原型只有"诅咒标记"（被标记的目标受到更多伤害）。
  {
    id: 'w_wugu',
    cn: '巫蛊引',
    series: 'ling',
    slot: 1,
    kind: 'projectile',
    unlock: 'initial',
    icon: 'doll',
    pattern: 'aimed',
    blurb: '被击中的敌人会被打上巫蛊标记，受到的伤害提高。',
    levels: [
      { damage: 10, count: 1, cd: 0.8, speed: 440, size: 8, mark: 1 },
      { damage: 13, count: 1, cd: 0.74, speed: 455, size: 9, mark: 1 },
      { damage: 17, count: 2, cd: 0.68, speed: 470, size: 10, mark: 2 },
      { damage: 22, count: 2, cd: 0.6, speed: 490, size: 11, mark: 2 },
      { damage: 29, count: 3, cd: 0.54, speed: 515, size: 12, mark: 3 },
    ],
  },
  {
    id: 'w_shigu',
    cn: '蚀骨蛊',
    series: 'ling',
    slot: 2,
    kind: 'projectile',
    unlock: 'pool',
    icon: 'bug',
    pattern: 'aimed',
    homing: 6,
    blurb: '放出的蛊虫会追着目标啃，命中后钻入体内持续啃噬。',
    levels: [
      { damage: 8, count: 1, cd: 1.1, speed: 380, size: 8, dot: 10 },
      { damage: 11, count: 1, cd: 1.0, speed: 400, size: 9, dot: 14 },
      { damage: 14, count: 2, cd: 0.94, speed: 420, size: 10, dot: 19 },
      { damage: 18, count: 3, cd: 0.86, speed: 445, size: 11, dot: 26 },
      { damage: 24, count: 4, cd: 0.76, speed: 470, size: 12, dot: 35 },
    ],
  },
  {
    id: 'w_shiwu',
    cn: '十巫幡',
    series: 'ling',
    slot: 3,
    kind: 'summon',
    unlock: 'pool',
    icon: 'banner',
    blurb: '召来的巫祝之影会跟着你冲杀。',
    levels: [
      { damage: 11, count: 1, cd: 4.6, hp: 36, speed: 172, life: 10 },
      { damage: 14, count: 1, cd: 4.2, hp: 46, speed: 178, life: 11 },
      { damage: 18, count: 2, cd: 3.8, hp: 58, speed: 184, life: 12 },
      { damage: 24, count: 2, cd: 3.2, hp: 74, speed: 190, life: 13 },
      { damage: 31, count: 3, cd: 2.6, hp: 94, speed: 198, life: 15 },
    ],
  },
  {
    id: 'w_lingwu',
    cn: '灵雾噬魂',
    series: 'ling',
    slot: 4,
    kind: 'zone',
    unlock: 'trial',
    icon: 'wraith',
    blurb: '在原地留下腐蚀之雾，雾中的敌人持续受创并被标记。',
    levels: [
      { damage: 5, count: 1, cd: 2.4, radius: 66, duration: 3.6, delay: 0.6, mark: 1 },
      { damage: 6, count: 1, cd: 2.2, radius: 72, duration: 4.0, delay: 0.55, mark: 1 },
      { damage: 8, count: 2, cd: 2.0, radius: 78, duration: 4.4, delay: 0.5, mark: 2 },
      { damage: 11, count: 2, cd: 1.8, radius: 86, duration: 5.0, delay: 0.45, mark: 2 },
      { damage: 14, count: 3, cd: 1.6, radius: 96, duration: 5.6, delay: 0.4, mark: 3 },
    ],
  },

  // ================= 昆仑 · 不死（第 6 系）=================
  // 定位：守护 · 回复。新机制原型只有"护盾/治疗"（护盾吸收 + 周期性壁垒）。
  {
    id: 'w_kunlun_1',
    cn: '昆仑玉琮',
    series: 'kun',
    slot: 1,
    kind: 'projectile',
    unlock: 'initial',
    icon: 'jade-disc',
    pattern: 'fan',
    blurb: '打出温润的玉片，命中回护自身。',
    levels: [
      { damage: 10, count: 2, cd: 0.72, speed: 430, size: 8, spread: 22 },
      { damage: 13, count: 3, cd: 0.68, speed: 445, size: 8, spread: 24 },
      { damage: 17, count: 4, cd: 0.62, speed: 460, size: 9, spread: 26 },
      { damage: 22, count: 5, cd: 0.56, speed: 480, size: 10, spread: 28 },
      { damage: 29, count: 6, cd: 0.5, speed: 505, size: 11, spread: 30 },
    ],
  },
  {
    id: 'w_kunlun_2',
    cn: '悬圃垂露',
    series: 'kun',
    slot: 2,
    kind: 'strike',
    unlock: 'pool',
    icon: 'drop',
    blurb: '天上落下甘露，砸出一圈治愈与冲击。',
    levels: [
      { damage: 14, count: 1, cd: 1.7, radius: 52, delay: 0.5 },
      { damage: 18, count: 1, cd: 1.6, radius: 56, delay: 0.48 },
      { damage: 24, count: 2, cd: 1.5, radius: 61, delay: 0.45 },
      { damage: 31, count: 3, cd: 1.4, radius: 67, delay: 0.42 },
      { damage: 41, count: 4, cd: 1.25, radius: 75, delay: 0.38 },
    ],
  },
  {
    id: 'w_kunlun_3',
    cn: '昆吾剑气',
    series: 'kun',
    slot: 3,
    kind: 'sweep',
    unlock: 'pool',
    icon: 'sword',
    blurb: '以昆吾之刃横扫身周，附带强击退。',
    levels: [
      { damage: 22, count: 1, cd: 1.15, radius: 104, arc: 120, knockback: 320 },
      { damage: 28, count: 1, cd: 1.05, radius: 114, arc: 130, knockback: 360 },
      { damage: 36, count: 1, cd: 0.98, radius: 126, arc: 140, knockback: 410 },
      { damage: 47, count: 1, cd: 0.9, radius: 140, arc: 152, knockback: 460 },
      { damage: 61, count: 2, cd: 0.8, radius: 156, arc: 165, knockback: 540 },
    ],
  },
  {
    id: 'w_kunlun_4',
    cn: '开明守御',
    series: 'kun',
    slot: 4,
    kind: 'aura',
    unlock: 'trial',
    icon: 'guardian',
    blurb: '身周展开守护壁垒：持续压制靠近的敌人，并缓慢为你充盾。',
    levels: [
      { dps: 12, radius: 84, tick: 0.5, shieldRegen: 2 },
      { dps: 16, radius: 92, tick: 0.5, shieldRegen: 3 },
      { dps: 22, radius: 100, tick: 0.46, shieldRegen: 4 },
      { dps: 30, radius: 110, tick: 0.42, shieldRegen: 5 },
      { dps: 40, radius: 122, tick: 0.38, shieldRegen: 7 },
    ],
  },

  // ================= 合体终极武器（6 系，各 1 把） =================
  // 这些不通过常规卡池获得；由"本系 4 把武器满级 + 指定被动 + **该系主动技已解锁**"
  // 触发**合体**，永久占满 4 个武器槽（见 fusions.js 的 ULTIMATE_FUSIONS 与
  // world.js 的 checkUltimateFusion / updateUltimates）。
  //
  // 批 1 只交付开局三系（shan / hai / huang）的**全新机制**：
  //   rift  裂地   —— 轨迹型（移动留下地裂，到期塌陷）
  //   tide  潮汐   —— 往返环（扩张后回卷收缩）
  //   storm 天罚轮转 —— 移动轰炸带（公转雷云 + 焦痕）
  // 后三系（tian / ling / kun）仍是 aura 占位，属**批 2**。
  //
  // 通用：合体后从 Lv1 开始，可升到 Lv5；Lv3 / Lv5 是质变点（见 HUD 的质变标记）。
  // locked: true 让它们不进入 BATCH1_WEAPONS / 升级卡池。
  {
    id: 'w_ult_shan',
    cn: '不周崩',
    series: 'shan',
    slot: 99,
    kind: 'rift',
    locked: true,
    icon: 'quake',
    blurb: '合体：沿移动轨迹留下地裂，裂心撕裂并推开来敌，地裂到期塌陷。站着不动就没有输出。',
    levels: [
      { damage: 126, dps: 185, spacing: 44, width: 64, life: 2.2, push: 260, collapse: 680, collapseRadius: 200, tick: 0.3 },
      { damage: 150, dps: 210, spacing: 43, width: 66, life: 2.3, push: 272, collapse: 782, collapseRadius: 205, tick: 0.3 },
      // Lv3 质变：塌陷变为牵引塌陷（把敌人拉进坑）
      { damage: 175, dps: 237, spacing: 42, width: 68, life: 2.4, push: 284, collapse: 897, collapseRadius: 210, tick: 0.29, pull: 300 },
      { damage: 205, dps: 267, spacing: 41, width: 70, life: 2.5, push: 296, collapse: 1012, collapseRadius: 215, tick: 0.28, pull: 340 },
      // Lv5 质变：双裂缝并行
      { damage: 239, dps: 301, spacing: 40, width: 72, life: 2.6, push: 308, collapse: 1139, collapseRadius: 220, tick: 0.27, pull: 380, parallel: 2 },
    ],
  },
  {
    id: 'w_ult_hai',
    cn: '归墟潮',
    series: 'hai',
    slot: 99,
    kind: 'tide',
    locked: true,
    icon: 'whale-beam',
    blurb: '合体：周期性推出水环，扩张到最大半径后回卷收缩，沿途敌人被沿环法向推动。',
    levels: [
      { damage: 52, period: 1.5, maxRadius: 240, band: 30, speed: 340 },
      { damage: 62, period: 1.44, maxRadius: 248, band: 32, speed: 360 },
      // Lv3 质变：第二道外环（内外交错）
      { damage: 73, period: 1.38, maxRadius: 254, band: 33, speed: 380, rings: 2 },
      { damage: 85, period: 1.31, maxRadius: 260, band: 34, speed: 390, rings: 2 },
      // Lv5 质变：回卷带拉拽（把敌人拖向你）
      { damage: 98, period: 1.24, maxRadius: 268, band: 35, speed: 400, rings: 2, retractPull: 300 },
    ],
  },
  {
    id: 'w_ult_huang',
    cn: '赤地千里',
    series: 'huang',
    slot: 99,
    kind: 'storm',
    locked: true,
    icon: 'miasma',
    blurb: '合体：一朵绕你公转的雷云，落雷始终落在云下，落点留下焦痕持续灼烧。',
    levels: [
      { damage: 318, orbit: 150, spin: 1.9, strike: 0.42, radius: 72, scorch: 110, scorchRadius: 78, scorchLife: 3.4 },
      { damage: 347, orbit: 168, spin: 2.05, strike: 0.39, radius: 76, scorch: 124, scorchRadius: 84, scorchLife: 3.6 },
      // Lv3 质变：焦痕扩散
      { damage: 379, orbit: 188, spin: 2.2, strike: 0.36, radius: 80, scorch: 140, scorchRadius: 92, scorchLife: 3.9 },
      { damage: 411, orbit: 210, spin: 2.35, strike: 0.33, radius: 85, scorch: 158, scorchRadius: 100, scorchLife: 4.2 },
      // Lv5 质变：双雷云反向公转
      { damage: 448, orbit: 234, spin: 2.5, strike: 0.3, radius: 90, scorch: 177, scorchRadius: 110, scorchLife: 4.6, clouds: 2 },
    ],
  },
  // 批 2 交付后三系（tian / ling / kun）的**全新机制**：
  //   sunwheel 十日凌空 —— 多光源扫射（身后 10 轮小太阳公转，每轮持续射出光束；周期性十日齐射）
  //   plague   百巫夜行 —— 传染型随从（巫影上蛊毒标记 + 少量直接伤害把传染链点着火；被标记者死亡爆毒雾并传染）
  //   bulwark  昆仑永镇 —— 反弹型护盾（自转玉璧环把**敌方子弹**反弹成己方子弹，同时持续回盾）
  {
    id: 'w_ult_tian',
    cn: '十日凌空',
    series: 'tian',
    slot: 99,
    kind: 'sunwheel',
    locked: true,
    icon: 'sun-lance',
    blurb: '合体：身后十轮小太阳绕你公转，每轮持续射出光束扫射；周期性十日齐射。',
    levels: [
      { suns: 10, orbit: 128, spin: 1.05, beamLen: 620, width: 24, dps: 160, tick: 0.1, volleyEvery: 4.4, volleyDamage: 1350, volleyRange: 660 },
      { suns: 10, orbit: 136, spin: 1.12, beamLen: 650, width: 25, dps: 185, tick: 0.1, volleyEvery: 4.2, volleyDamage: 1560, volleyRange: 680 },
      // Lv3 质变：太阳数增加 / 光束变粗
      { suns: 12, orbit: 144, spin: 1.18, beamLen: 680, width: 28, dps: 210, tick: 0.1, volleyEvery: 4.0, volleyDamage: 1800, volleyRange: 700 },
      { suns: 12, orbit: 152, spin: 1.24, beamLen: 710, width: 30, dps: 240, tick: 0.1, volleyEvery: 3.8, volleyDamage: 2080, volleyRange: 720 },
      // Lv5 质变：十日齐射强化（每轮太阳的齐射贯穿多个目标）
      { suns: 14, orbit: 162, spin: 1.3, beamLen: 740, width: 34, dps: 275, tick: 0.1, volleyEvery: 3.6, volleyDamage: 2480, volleyRange: 740, volleyPierce: 3 },
    ],
  },
  {
    id: 'w_ult_ling',
    cn: '百巫夜行',
    series: 'ling',
    slot: 99,
    kind: 'plague',
    locked: true,
    icon: 'hex-mist',
    blurb: '合体：召巫影（接触时给敌人上蛊毒标记并造成少量直接伤害），蛊毒持续发作，被标记者死亡时爆毒雾并把标记传染。',
    levels: [
      { wraiths: 6, markStacks: 1, plagueDps: 60, wraithDamage: 30, wraithSpeed: 150, wraithHp: 60, mistDps: 72, mistRadius: 72, mistLife: 2.4, mistMax: 8, spreadRadius: 110, maxDepth: 3, splitMax: 0 },
      { wraiths: 7, markStacks: 1, plagueDps: 70, wraithDamage: 34, wraithSpeed: 155, wraithHp: 72, mistDps: 86, mistRadius: 76, mistLife: 2.5, mistMax: 9, spreadRadius: 122, maxDepth: 3, splitMax: 0 },
      // Lv3 质变：传染范围扩大
      { wraiths: 8, markStacks: 2, plagueDps: 82, wraithDamage: 38, wraithSpeed: 160, wraithHp: 86, mistDps: 104, mistRadius: 82, mistLife: 2.6, mistMax: 11, spreadRadius: 168, maxDepth: 4, splitMax: 0 },
      { wraiths: 9, markStacks: 2, plagueDps: 96, wraithDamage: 45, wraithSpeed: 165, wraithHp: 104, mistDps: 125, mistRadius: 88, mistLife: 2.8, mistMax: 13, spreadRadius: 185, maxDepth: 4, splitMax: 0 },
      // Lv5 质变：被标记者死亡时分裂出新巫影（有数量上限）
      { wraiths: 10, markStacks: 3, plagueDps: 115, wraithDamage: 52, wraithSpeed: 170, wraithHp: 124, mistDps: 150, mistRadius: 96, mistLife: 3.0, mistMax: 16, spreadRadius: 210, maxDepth: 5, splitMax: 6 },
    ],
  },
  {
    id: 'w_ult_kun',
    cn: '昆仑永镇',
    series: 'kun',
    slot: 99,
    kind: 'bulwark',
    locked: true,
    icon: 'aegis',
    blurb: '合体：自转的玉璧环把敌方子弹反弹成己方子弹，环体本身也碾压接触到的敌人，同时持续为你回盾。',
    levels: [
      { orbit: 100, band: 26, spin: 1.6, rings: 1, dps: 150, reflectMul: 215, reflectPierce: 1, shieldCap: 45, shieldRegen: 3.5, homing: 0 },
      { orbit: 108, band: 28, spin: 1.7, rings: 1, dps: 185, reflectMul: 250, reflectPierce: 1, shieldCap: 52, shieldRegen: 4.5, homing: 0 },
      // Lv3 质变：第二层玉璧（反向自转）
      { orbit: 116, band: 30, spin: 1.8, rings: 2, dps: 225, reflectMul: 295, reflectPierce: 2, shieldCap: 60, shieldRegen: 5.5, homing: 0 },
      { orbit: 126, band: 32, spin: 1.9, rings: 2, dps: 270, reflectMul: 345, reflectPierce: 2, shieldCap: 70, shieldRegen: 7, homing: 0 },
      // Lv5 质变：反弹出的子弹变为金色追踪弹（贯穿更多目标）
      { orbit: 138, band: 36, spin: 2.0, rings: 2, dps: 320, reflectMul: 405, reflectPierce: 4, shieldCap: 82, shieldRegen: 9, homing: 5.5, golden: true },
    ],
  },
];

export const WEAPON_BY_ID = {};
for (const w of WEAPONS) WEAPON_BY_ID[w.id] = w;

export const BATCH1_WEAPONS = WEAPONS.filter((w) => !w.locked);

export const WEAPON_KIND_CN = {
  orbit: '环绕',
  boomerang: '回旋',
  sweep: '横扫',
  projectile: '投射',
  beam: '光束',
  strike: '天降',
  zone: '区域',
  summon: '召唤',
  aura: '领域',
  charge: '蓄力',
  // 批 1 合体终极专属机制
  rift: '裂地',
  tide: '潮汐',
  storm: '天罚轮转',
  // 批 2 合体终极专属机制
  sunwheel: '十日',
  plague: '蛊毒',
  bulwark: '玉璧',
};

/** 取某等级的数值（等级从 1 开始；超界时夹取到最高级）*/
export function levelStats(weapon, level) {
  const idx = Math.max(0, Math.min(weapon.levels.length - 1, (level | 0) - 1));
  return weapon.levels[idx];
}

/** 池中可发的武器（批 1：前 9 把；trial 解锁由解锁状态决定）*/
export function weaponPool(unlockedIds) {
  return BATCH1_WEAPONS.filter((w) => w.unlock !== 'trial' || unlockedIds.includes(w.id));
}
