/** shared 纯函数单元自检（零依赖，运行：corepack pnpm unit；退出码 0 = 通过）。
 *  覆盖碰撞/开火解算/武器数值/库存状态机/解锁链——此前这些最核心的逻辑零测试覆盖。 */

import {
  DEFAULT_MAP,
  MAPS,
  WEAPON_ORDER,
  WEAPONS,
  WeaponInventory,
  damageAtRange,
  fireIntervalSec,
  isWall,
  pickSpawnFarthest,
  rayVsAABB,
  raycastWalls,
  resolveCircleWalls,
  resolveShot,
  specForTier,
  tierForKills,
  type AABB,
  type GameMap,
} from '@DoShoot/shared';

let passed = 0;
const failures: string[] = [];

function eq(name: string, actual: unknown, expected: unknown, eps = 1e-9): void {
  const ok2 =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= eps
      : actual === expected;
  if (ok2) passed++;
  else failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
}

function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else failures.push(name);
}

// ---------- rayVsAABB（slab 法 + 零分量加固） ----------
const box: AABB = { minX: 2, minY: 3, maxX: 4, maxY: 5 };
eq('rayVsAABB 正向命中', rayVsAABB(0, 4, 1, 0, box), 2);
eq('rayVsAABB 反向命中', rayVsAABB(6, 4, -1, 0, box), 2);
eq('rayVsAABB 斜向命中', rayVsAABB(0, 0, Math.SQRT1_2, Math.SQRT1_2, box), Math.SQRT2 * 3, 1e-6);
eq('rayVsAABB 背向不命中', rayVsAABB(0, 4, -1, 0, box), null);
eq('rayVsAABB 平行错过 (dx=0)', rayVsAABB(6, 4, 0, 1, box), null);
eq('rayVsAABB 平行穿过 (dx=0)', rayVsAABB(3, 0, 0, 1, box), 3);
eq('rayVsAABB 起点在盒内', rayVsAABB(3, 4, 1, 0, box), 0);

// ---------- raycastWalls / isWall（DDA 网格遍历） ----------
const map: GameMap = DEFAULT_MAP;
ok('raycastWalls 起点在墙内 → 0', raycastWalls(map, 0.5, 0.5, 1, 0, 10) === 0);
// 沿 x=2.5 从 y=2.5 向下：x=2 列全空，直达南边界墙 y=39 → 命中距离 36.5
eq('raycastWalls 穿墙命中距离', raycastWalls(map, 2.5, 2.5, 0, 1, 40), 36.5, 1e-6);
// 沿 y=2 行向右：10 单位内全是空地（边界墙在 36.5 之外）
ok('raycastWalls 开阔路径无命中', raycastWalls(map, 2.5, 2.5, 1, 0, 10) === null);
ok('raycastWalls 超过 maxDist 不命中', raycastWalls(map, 2.5, 2.5, 0, 1, 5) === null);
ok('isWall 越界视为墙', isWall(map, -1, 5) && isWall(map, 5, 999));

// ---------- resolveCircleWalls（圆-网格推出） ----------
{
  // 贴墙：从 (10.5, 7.9) 顶入 L 形掩体行 y=8（x 8..12）→ 圆心被推出到 y = 8 - r
  const r = resolveCircleWalls(map, 10.5, 7.9, 0.4);
  eq('resolveCircleWalls 沿推出方向贴墙', r.y, 8 - 0.4, 1e-6);
  // 圆心深入孤立单格墙 (5,20) 内部：四向等深时按实现取 left 分支 → x = 5 - r（cell (4,20) 为空地）
  const deep = resolveCircleWalls(map, 5.5, 20.5, 0.4);
  eq('resolveCircleWalls 内部最浅方向推出', deep.x, 5 - 0.4, 1e-6);
  // 空地位置不变
  const free = resolveCircleWalls(map, 20.5, 2.5, 0.4);
  eq('resolveCircleWalls 空地不变', free.y, 2.5);
}

// ---------- damageAtRange / fireIntervalSec（FR-W2 数值衰减） ----------
{
  const spec = WEAPONS.ar!;
  eq('damageAtRange 满伤区内', damageAtRange(spec, 5), spec.damage);
  eq('damageAtRange 边界=满伤', damageAtRange(spec, spec.fullDamageRange), spec.damage);
  eq('damageAtRange maxRange=最低倍率', damageAtRange(spec, spec.maxRange), spec.damage * spec.minDamageMult);
  const mid = (spec.fullDamageRange + spec.maxRange) / 2;
  const f = (mid - spec.fullDamageRange) / (spec.maxRange - spec.fullDamageRange);
  eq('damageAtRange 中点线性', damageAtRange(spec, mid), spec.damage * (1 - f * (1 - spec.minDamageMult)));
  eq('fireIntervalSec SMG=60/900', fireIntervalSec(WEAPONS.smg!), 60 / 900);
}

// ---------- WeaponInventory（换弹/切枪打断/冷却/校正） ----------
{
  const inv = new WeaponInventory();
  const t0 = 10;
  eq('初始手枪满弹匣', inv.state.ammo, WEAPONS.pistol!.magSize);
  eq('初始备弹', inv.state.reserve, WEAPONS.pistol!.reserveAmmo);

  // 消耗 1 发 → 换弹中不能开火、进度推进、完成后回补
  inv.consumeAmmo();
  ok('startReload 成功', inv.startReload(t0));
  ok('换弹中 canFire=false', !inv.canFire(t0));
  inv.update(t0 + WEAPONS.pistol!.reloadTime! / 2);
  eq('换弹未完成进度<1', inv.reloadProgress(t0 + WEAPONS.pistol!.reloadTime! / 2)! < 1, true);
  inv.update(t0 + WEAPONS.pistol!.reloadTime! + 0.01);
  eq('换弹完成弹匣回满', inv.state.ammo, WEAPONS.pistol!.magSize);
  eq('备弹扣 1', inv.state.reserve, WEAPONS.pistol!.reserveAmmo - 1);
  eq('完成后 reloadProgress=null', inv.reloadProgress(t0 + 20), null);

  // 切枪打断换弹（FR-W3）
  inv.consumeAmmo();
  inv.startReload(t0);
  ok('切枪成功', inv.switchTo('smg', t0));
  eq('切枪打断换弹（旧武器 reloadEnd 清除）', inv.states.pistol!.reloadEnd, null);
  eq('当前武器=smg', inv.current, 'smg');
  ok('切枪硬直内不可开火', !inv.canFire(t0 + 0.1));
  ok('硬直后可开火', inv.canFire(t0 + 0.26));

  // cycle 顺序切换 + 非法 id 防御
  inv.cycle(1, t0 + 1);
  eq('cycle 向下一切', inv.current, 'ar');
  ok('非法 id 不切换', !inv.switchTo('unknown' as never, t0 + 1));
  eq('非法 id 后仍是 ar', inv.current, 'ar');

  // markFired 冷却 / resyncAmmo 校正
  inv.markFired(t0 + 2);
  ok('markFired 后进入冷却', !inv.canFire(t0 + 2 + 1e-9));
  inv.resyncAmmo(3, 21);
  eq('resyncAmmo 弹匣', inv.state.ammo, 3);
  eq('resyncAmmo 备弹', inv.state.reserve, 21);
  eq('resyncAmmo 清除换弹', inv.state.reloadEnd, null);

  // resetAll：重生语义（全部满、回到手枪）
  inv.resetAll();
  eq('resetAll 回到手枪', inv.current, 'pistol');
  eq('resetAll 手枪满匣', inv.state.ammo, WEAPONS.pistol!.magSize);
}

// ---------- 解锁链 tierForKills / specForTier（FR-W1） ----------
{
  eq('0 杀=T1', tierForKills('pistol', 0), 0);
  eq('7 杀=T1', tierForKills('pistol', 7), 0);
  eq('8 杀=T2', tierForKills('pistol', 8), 1);
  eq('19 杀=T2', tierForKills('smg', 19), 1);
  eq('20 杀=T3', tierForKills('smg', 20), 2);
  eq('越界钳到最高层', specForTier('sniper', 99).nameKey, 'weapon.sniper.t3');
  eq('负数钳到 T1', specForTier('lmg', -3).nameKey, 'weapon.lmg');
  for (const id of WEAPON_ORDER) {
    ok(`tiers id 保持 ${id}`, specForTier(id, 0).id === id);
  }
}

// ---------- resolveShot（散布/多弹丸/墙体遮挡/实体命中） ----------
{
  const spec = { ...WEAPONS.pistol!, spreadDeg: 0, pellets: 3, maxRange: 30 };
  // 射手 (2.5, 2.5) 朝正下方（angle=0 → 方向 (0,1)，x=2 列在 range 图上全空）
  const targets = [{ hitbox: { minX: 2.05, minY: 19.55, maxX: 2.95, maxY: 20.45 }, alive: true }];
  const hit = resolveShot(map, 2.5, 2.5, 0, spec.spreadDeg, spec, targets);
  eq('resolveShot 弹丸数', hit.length, 3);
  ok('resolveShot 命中目标', hit.every((p) => p.hitIndex === 0));
  // 目标移出射线 → 全部 miss（hitIndex=null）
  const miss = resolveShot(map, 2.5, 2.5, 0, 0, spec, [
    { hitbox: { minX: 10, minY: 10, maxX: 10.5, maxY: 10.5 }, alive: true },
  ]);
  ok('resolveShot 无目标命中', miss.every((p) => p.hitIndex === null));
  // 死亡目标不参与命中
  const dead = resolveShot(map, 2.5, 2.5, 0, 0, spec, [
    { hitbox: targets[0]!.hitbox, alive: false },
  ]);
  ok('resolveShot 跳过死亡目标', dead.every((p) => p.hitIndex === null));
  // 墙体截断：从 (20.5, 2.5) 向下（angle=0 → 方向 (0,1)）在 y=5 处被单箱 (20,5) 截断——
  // 与 raycastWalls 的权威距离做一致性断言（不硬编码格位）
  const wallDist = raycastWalls(map, 20.5, 2.5, 0, 1, 30);
  ok('墙距合法（30 单位内有墙）', wallDist !== null && wallDist < 30);
  const wall = resolveShot(map, 20.5, 2.5, 0, 0, spec, []);
  eq('resolveShot 弹道被墙截断', wall[0]!.dist, wallDist!);
  // 散布非零：弹丸距离仍在合法范围内
  const spread = resolveShot(map, 2.5, 2.5, 0, 5, spec, targets);
  ok('resolveShot 散布弹丸距离合法', spread.every((p) => p.dist >= 0 && p.dist <= spec.maxRange));
}

// ---------- pickSpawnFarthest（FR-MP3） ----------
{
  const m = MAPS.range!;
  const far = pickSpawnFarthest(m, [{ x: 2.5, y: 2.5 }]);
  ok('pickSpawnFarthest 选中远离敌人的点', Math.hypot(far.x - 2.5, far.y - 2.5) > 30);
  const any = pickSpawnFarthest(m, []);
  ok('pickSpawnFarthest 无敌人返回合法出生点', m.spawns.some((s) => s.x === any.x && s.y === any.y));
}

// ---------- 汇总 ----------
if (failures.length > 0) {
  console.error(`[unit] FAIL（${failures.length} 项）:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[unit] OK — ${passed} 项断言全部通过（碰撞/开火解算/数值衰减/库存/解锁链/出生点）`);
