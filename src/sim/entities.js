// 实体工厂。所有实体都是纯数据对象（可序列化），不含行为方法。
// 池化对象在 reset 时必须写全字段，禁止残留上一轮的状态。

export function makeEnemy() {
  return {
    __alive: false,
    id: 0,
    kind: 'shanxiao',
    elite: false,
    affix: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    hp: 1,
    maxHp: 1,
    radius: 12,
    speed: 60,
    touchDamage: 8,
    tier: 0,
    ai: 'chase',
    // 状态
    slowUntil: 0,
    slowMul: 1,
    burnDps: 0,
    burnUntil: 0,
    curseUntil: 0,
    // 巫蛊标记（灵山系）：被标记时受到的伤害提高，持续 4 秒
    mark: 0,
    markUntil: 0,
    // 百巫传染链的层数（-1 = 这层标记不是百巫上的）；plagueBurst = 本次死亡已经爆过毒
    plagueDepth: -1,
    plagueBurst: false,
    // 蛊毒发作：标记本身就是毒（**不是巫影的直接伤害**），被标记者持续掉血
    plagueDps: 0,
    plagueUntil: 0,
    plagueTick: 0,
    // 十日凌空：这道光束对本体的再命中冷却（每帧递减）
    sunCd: 0,
    // 玉璧环碾压：环体接触伤害对本体的再命中冷却（每帧递减）
    bulwarkCd: 0,
    stunUntil: 0,
    dotTick: 0,
    // 远程/冲锋参数
    fireCd: 0,
    fireEvery: 2,
    chargeState: 0,
    chargeCd: 0,
    chargeWindupUntil: 0,
    // 自爆引信（给玩家反应时间；没有预警的自爆=不公平）
    fuseUntil: 0,
    // 精英词缀
    summonCd: 0,
    enrageMul: 1,
    // 个体差异（用种子化的确定性哈希，禁止读 Math.random）
    approachBias: 0,
    // 受击反馈
    hitFlash: 0,
    facing: 0,
    xp: 1,
    bossPhase: 0,
    isBoss: false,
    colorSeed: 0,
    // 视觉推断（渲染层只读）
    wobble: 0,
    // 本次命中记录（防止同一投射物重复命中同一敌人）
    lastHitBy: 0,
    lastHitFrame: -1,
  };
}

export function makeBullet() {
  return {
    __alive: false,
    id: 0,
    owner: 'player', // player | enemy
    weaponId: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: 1,
    pierce: 0,
    hits: 0,
    life: 0,
    maxLife: 3,
    homing: 0,
    speed: 0,
    split: 0,
    splitDepth: 0,
    dot: 0,
    knockback: 0,
    crit: false,
    color: '#fff',
    shape: 'dot',
    // 回旋镖
    boomerang: false,
    boomPhase: 0,
    originX: 0,
    originY: 0,
    returnSpeed: 0,
    spin: 0,
    // 敌人子弹用
    pattern: null,
    // 命中过的敌人 id 列表（穿透不重复命中）
    hitIds: null,
  };
}

export function makeZone() {
  return {
    __alive: false,
    id: 0,
    kind: 'poison', // poison | fire | scorch | slow | warning | stonewall | rift | shock
    x: 0,
    y: 0,
    radius: 60,
    damage: 0,
    dps: 0,
    life: 0,
    maxLife: 4,
    tick: 0,
    owner: 'player',
    color: '#8f8',
    delay: 0, // 预警圈：delay 结束后才生效
    warnTotal: 0, // 预警总时长（用于渲染进度；不能从 maxLife-0.5 反推，链式落雷会算出负数）
    strikeDamage: 0,
    slowMul: 1,
    knockback: 0,
    pull: 0,
    spread: false,
    chain: 0,
    weaponId: null,
    mark: 0,
    // —— 批 1 新增：合体终极（裂地 / 天罚轮转）与主动技（立岩）用的字段 ——
    collapse: 0, // 地裂到期塌陷的爆发伤害
    collapseRadius: 0,
    scorch: 0, // 落雷后留下的焦痕（独立区域，与雷击伤害分开计算）
    scorchRadius: 0,
    scorchLife: 0,
    followPlayer: false, // 石壁跟着玩家走（立岩的"喘息圈"语义）
    // —— 批 2 新增：百巫的毒雾（plagueDepth 是它在传染链里的层数）——
    plagueDepth: -1,
  };
}

/**
 * 环形波（合体终极「归墟潮 · 潮汐」）。
 * 不是"以玩家为圆心的伤害圈"，而是**一道有半径、会移动的环**：
 * 扩张到最大半径后回卷收缩；同一道环对同一个敌人**每个阶段只结算一次**。
 */
export function makeRing() {
  return {
    __alive: false,
    id: 0,
    weaponId: null,
    x: 0,
    y: 0,
    r: 0, // 当前半径
    maxR: 200,
    band: 28, // 环的判定带宽
    speed: 300, // 半径变化速度（点/秒）
    phase: 'out', // out = 扩张 / in = 回卷
    damage: 0,
    dps: 0, // 环扫过时的持续伤害（可选，潮汐用一次性伤害）
    pull: 0, // 回卷阶段的拉拽（Lv5 质变）
    color: '#7fd6ee',
    // 每个阶段各命中一次的 id 表（同一道环不重复结算）
    hitOut: null,
    hitIn: null,
  };
}


export function makeDrop() {
  return {
    __alive: false,
    id: 0,
    kind: 'xp', // xp | heal
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    value: 1,
    radius: 6,
    magnet: false,
    life: 0,
    bob: 0,
  };
}

export function makeDamageNumber() {
  return {
    __alive: false,
    id: 0,
    x: 0,
    y: 0,
    value: 0,
    life: 0,
    maxLife: 0.7,
    crit: false,
    kind: 'hit', // hit | heal | xp
    merged: 1,
  };
}

export function makeParticle() {
  return {
    __alive: false,
    id: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0.4,
    radius: 3,
    color: '#fff',
  };
}

export function makeMinion() {
  return {
    __alive: false,
    id: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    hp: 20,
    maxHp: 20,
    damage: 8,
    radius: 12,
    speed: 170,
    life: 0,
    maxLife: 99999,
    targetId: 0,
    attackCd: 0,
    heads: 1,
    hitFlash: 0,
    facing: 0,
    // 百巫的巫影：plague = 只上蛊毒标记、不造成直接伤害
    plague: false,
    markStacks: 1,
  };
}

export function makeOrbitBlade() {
  return {
    __alive: false,
    id: 0,
    ownerWeapon: null,
    angle: 0,
    radius: 70,
    count: 1,
    damage: 1,
    width: 8,
    height: 26,
    knockback: 0,
    hitCd: 0, // 每个刃的命中冷却（防止每帧都判定）
    color: '#fff',
  };
}

export function makeBeam() {
  return {
    __alive: false,
    id: 0,
    ownerWeapon: null,
    x: 0,
    y: 0,
    angle: 0,
    length: 520,
    width: 22,
    damage: 1,
    dps: 0,
    life: 0.3,
    maxLife: 0.3,
    pierce: 99,
    color: '#fff',
  };
}
