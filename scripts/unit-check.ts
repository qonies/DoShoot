/** shared 纯函数 + 服务端 Room 状态机单元自检（零依赖，运行：corepack pnpm unit；退出码 0 = 通过）。
 *  覆盖碰撞/开火解算/武器数值/库存状态机/解锁链/滚轮顺序/房间状态机——此前这些最核心的逻辑零测试覆盖。 */

import {
  CHEAT_RUSH_CODE,
  DEFAULT_MAP,
  MAPS,
  WEAPON_ORDER,
  WEAPONS,
  WeaponInventory,
  damageAtRange,
  fireIntervalSec,
  isWall,
  nextWeaponId,
  normalizeRoomCode,
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
import { Room } from '../apps/server/src/room';
import { clientToNdc, dpadVector, stickVector } from '../apps/client/src/game/touchmath';
import type { Server } from 'socket.io';

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

// ---------- WeaponInventory 冲锋枪彩蛋模式（FR-E1：无限弹药/白名单/跨重生保留/回合结束撤销） ----------
{
  const inv = new WeaponInventory();
  const t0 = 10;
  ok('grantRush 授予', inv.grantRush(t0));
  eq('授予后当前武器=rush', inv.current, 'rush');
  eq('rush 满匣', inv.state.ammo, WEAPONS.rush!.magSize);
  ok('切枪硬直内不可开火', !inv.canFire(t0 + 0.1));
  inv.markFired(t0 + 0.3);
  inv.consumeAmmo();
  eq('无限弹药：开火后弹匣不消耗', inv.state.ammo, WEAPONS.rush!.magSize);
  ok('无限弹药：startReload 被禁用', !inv.startReload(t0 + 0.3));
  ok('switchTo 白名单拒绝 rush（切枪输入不可获得/切走）', !inv.switchTo('rush', t0 + 0.4));
  // 跨重生保留（resetAll 后仍持 rush 满匣）
  inv.resetAll();
  eq('resetAll 后仍持 rush（跨重生保留）', inv.current, 'rush');
  eq('resetAll 后 rush 满匣', inv.state.ammo, WEAPONS.rush!.magSize);
  // 回合结束撤销 → 回手枪满匣
  ok('revokeRush 撤销', inv.revokeRush());
  eq('撤销后回手枪', inv.current, 'pistol');
  eq('撤销后手枪满匣', inv.state.ammo, WEAPONS.pistol!.magSize);
  ok('未激活时重复撤销返回 false', !inv.revokeRush());
  ok('撤销后可重新授予', inv.grantRush(t0 + 1));
  ok('已激活时重复授予返回 false', !inv.grantRush(t0 + 1.1));
  // 彩蛋武器无解锁链：tierForKills 恒 0
  eq('rush 无解锁链（恒 T1）', tierForKills('rush', 999), 0);
  eq('rush 数值定位（specForTier）', specForTier('rush', 0).id, 'rush');
  // 彩蛋模式中手动切枪 = 主动放弃（rushActive 复位，可重新激活）
  ok('彩蛋模式中切枪成功', inv.switchTo('ar', t0 + 2));
  eq('切枪后 rushActive 复位', inv.rushActive, false);
  eq('切枪后当前武器=ar', inv.current, 'ar');
  ok('放弃后可重新授予', inv.grantRush(t0 + 2.1));
  eq('重新授予后回到 rush', inv.current, 'rush');
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

// ---------- nextWeaponId（FR-W4 滚轮顺序；环绕与 rush 起点） ----------
{
  eq('nextWeaponId pistol+1=smg', nextWeaponId('pistol', 1), 'smg');
  eq('nextWeaponId lmg+1=pistol（环绕）', nextWeaponId('lmg', 1), 'pistol');
  eq('nextWeaponId pistol-1=lmg（环绕）', nextWeaponId('pistol', -1), 'lmg');
  eq('nextWeaponId rush+1=pistol', nextWeaponId('rush', 1), 'pistol');
  eq('nextWeaponId rush-1=sniper', nextWeaponId('rush', -1), 'sniper');
}

// ---------- normalizeRoomCode（FR-L8 房间号规范化） ----------
eq('normalizeRoomCode 纯 4 位数字', normalizeRoomCode('4821'), '4821');
eq('normalizeRoomCode 去空格与横线', normalizeRoomCode(' 48-21 '), '4821');
eq('normalizeRoomCode 3 位拒绝', normalizeRoomCode('482'), null);
eq('normalizeRoomCode 5 位拒绝', normalizeRoomCode('48215'), null);
eq('normalizeRoomCode 含字母拒绝', normalizeRoomCode('48a1'), null);
eq('normalizeRoomCode 空串拒绝', normalizeRoomCode(''), null);

// ---------- stickVector（FR-U6 触屏摇杆：钳制/归一化/死区/平滑） ----------
{
  const full = stickVector(64, 0, 64, 14);
  eq('stickVector 满程右移 x=1', full.x, 1, 1e-6);
  eq('stickVector 满程右移 y=0', full.y, 0);
  const diag = stickVector(64, 64, 64, 14);
  ok('stickVector 斜向超程钳制（模长 1）', Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-6);
  const half = stickVector(32, 0, 64, 14);
  ok('stickVector 半程幅度平滑（0 < mag < 1）', half.x > 0 && half.x < 1);
  const dz = stickVector(14, 0, 64, 14);
  ok('stickVector 死区边缘为零', dz.x === 0 && dz.y === 0);
  const inDz = stickVector(5, 5, 64, 14);
  ok('stickVector 死区内为零', inDz.x === 0 && inDz.y === 0);
  eq('stickVector radius=0 安全', stickVector(10, 10, 0, 14).x, 0);
  const up = stickVector(0, -64, 64, 14);
  eq('stickVector 上推 y=-1（屏幕 y 向下 = 世界 y 同向）', up.y, -1, 1e-6);
}

// ---------- dpadVector / clientToNdc（FR-U6 pad 模式：D-pad + 点击射击） ----------
{
  const u = dpadVector(true, false, false, false);
  eq('dpad 上=(0,-1)', u.y, -1, 1e-6);
  eq('dpad 上 x=0', u.x, 0);
  const d = dpadVector(false, true, false, false);
  eq('dpad 下=(0,1)', d.y, 1, 1e-6);
  const l = dpadVector(false, false, true, false);
  eq('dpad 左=(-1,0)', l.x, -1, 1e-6);
  const r = dpadVector(false, false, false, true);
  eq('dpad 右=(1,0)', r.x, 1, 1e-6);
  const diag = dpadVector(true, false, false, true); // 上 + 右 = 右上斜向
  ok('dpad 右上斜向模长 1', Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-6);
  ok('dpad 斜向分量 1/√2', Math.abs(diag.x - Math.SQRT1_2) < 1e-6 && Math.abs(diag.y + Math.SQRT1_2) < 1e-6);
  const cancel = dpadVector(true, true, false, false); // 对向同按抵消
  ok('dpad 上下对向抵消', cancel.x === 0 && cancel.y === 0);
  const none = dpadVector(false, false, false, false);
  ok('dpad 无输入为零向量', none.x === 0 && none.y === 0);

  const c = clientToNdc(50, 50, 100, 100);
  ok('clientToNdc 中心=(0,0)', Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9);
  const tl = clientToNdc(0, 0, 100, 100);
  ok('clientToNdc 左上=(-1,1)', tl.x === -1 && tl.y === 1);
  const br = clientToNdc(100, 100, 100, 100);
  ok('clientToNdc 右下=(1,-1)', br.x === 1 && br.y === -1);
  const safe = clientToNdc(10, 10, 0, 0);
  ok('clientToNdc 零尺寸安全', safe.x === 0 && safe.y === 0);
}

// ---------- 汇总（含服务端 Room 状态机的实时等待检查） ----------
/** Room 状态机检查：空房复用重置 / 已结束房间结算补发 / rematch 不复活断线者 / 等待房间（FR-L8）。
 *  用 1s 时限的房间让对局自然结束（killTarget=30 不可能被 Bot 提前触发），三间并行推进。 */
async function roomChecks(): Promise<void> {
  // 广播桩：Room 仅需 io.to(roomId).emit，单测不建立真实连接
  const fakeIo = { to: () => ({ emit: () => {} }) } as unknown as Server;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  // 既有对局状态机检查需立即开局的房间（autoStart = true，快速加入新建语义）
  const reuse = new Room(fakeIo, DEFAULT_MAP, 'unit-reuse', 'normal', 30, 1, undefined, '', true);
  const joinOver = new Room(fakeIo, DEFAULT_MAP, 'unit-joinover', 'normal', 30, 1, undefined, '', true);
  const reGrp = new Room(fakeIo, DEFAULT_MAP, 'unit-rematch', 'normal', 30, 1, undefined, '', true);
  reuse.addPlayer('p0', 'P0');
  joinOver.addPlayer('a', 'A');
  reGrp.addPlayer('a', 'A');
  await sleep(2600); // 1s 时限到期 → matchEnd

  // 1) 时限到期 → welcome 携带最近一次结算（FR-M1/L7）
  ok('时限到期 → welcome.matchEnd 存在', joinOver.welcome('a').matchEnd !== undefined);

  // 2) 中途加入已结束房间（房内仍有人 → 不重置）→ 补发结算
  joinOver.addPlayer('b', 'B');
  ok('加入已结束房间 → welcome.matchEnd 补发', joinOver.welcome('b').matchEnd !== undefined);

  // 3) 空房复用（removePlayer 后再 addPlayer）→ 对局重置，结算不残留
  reuse.removePlayer('p0');
  reuse.addPlayer('p1', 'P1');
  ok('空房复用后对局重置（matchEnd 不残留）', reuse.welcome('p1').matchEnd === undefined);

  // 4) rematch 不复活断线宽限中的玩家（disconnectAt 保持，宽限清扫/rejoin 语义不变）
  reGrp.markDisconnected('a');
  ok('rematch 生效', reGrp.rematch());
  ok('rematch 后对局重置（matchEnd 清空）', reGrp.welcome('a').matchEnd === undefined);
  ok('断线者保持宽限（不被复活）', reGrp.isDisconnected('a'));
  ok('宽限内仍可重连', reGrp.tryRejoin('a'));

  // 5) 等待房间状态机（FR-L8）：waiting 不步进不广播、房主专属调参与开局、Bot 延后加入
  const wait = new Room(fakeIo, DEFAULT_MAP, 'unit-wait', 'normal', 30, 300, 5, '4821', false);
  ok('等待房初始为 waiting 态', wait.state === 'waiting');
  ok('房间号保持传入值', wait.code === '4821');
  wait.addPlayer('h1', 'H1', undefined, true);
  wait.addPlayer('h2', 'H2');
  ok('建房者为房主', wait.hostId === 'h1');
  ok('等待态彩蛋口令被拒（NFR-5/FR-E1，防止开局自带无限弹药）', !wait.requestRush('h1', CHEAT_RUSH_CODE));
  ok('等待态不加入 Bot（开局才补齐）', wait.roomInfo().players.length === 2 && wait.welcome('h1').entities.every((e) => !e.bot));
  ok('welcome.room 完整（FR-L8）', wait.welcome('h2').room?.code === '4821' && wait.welcome('h2').room?.hostId === 'h1');
  ok('非房主调参被拒', !wait.updateSettings('h2', { killTarget: 50 }));
  ok('房主调参生效', wait.updateSettings('h1', { killTarget: 50, botCount: 0 }));
  ok('参数回流 welcome.room', wait.welcome('h2').room?.killTarget === 50);
  ok('非法参数被白名单过滤', !wait.updateSettings('h1', { killTarget: 77, timeLimitSec: 123, botCount: 4 }));
  ok('换地图生效', wait.updateSettings('h1', { mapId: 'alley' }) && wait.mapId === 'alley');
  const moved = wait.welcome('h1').entities;
  ok('换图后玩家坐标重置到新图内', moved.length === 2 && moved.every((e) => e.x >= 0 && e.x <= 40 && e.y >= 0 && e.y <= 40));
  await sleep(1200);
  ok('等待态不步进（tick 冻结）', wait.welcome('h1').tick === 0);
  ok('非房主不能开局', !wait.start('h2'));
  ok('房主开局生效', wait.start('h1'));
  ok('开局后进入 running 态', wait.welcome('h1').room?.state === 'running');
  ok('开局后 Bot 按 botCount=0 补齐', wait.welcome('h1').entities.every((e) => !e.bot));
  ok('开局后非房主调参被拒（running 态锁定）', !wait.updateSettings('h1', { killTarget: 100 }));
  ok('开局后彩蛋口令可授予（守卫仅拦等待态）', wait.requestRush('h1', CHEAT_RUSH_CODE));
  wait.removePlayer('h1');
  ok('房主离开后移交下一位真人', wait.hostId === 'h2');
  wait.destroy(); // 销毁 interval，让事件循环自然退出（与其余房间一致）

  reuse.destroy();
  joinOver.destroy();
  reGrp.destroy();
}

async function main(): Promise<void> {
  await roomChecks();
  if (failures.length > 0) {
    console.error(`[unit] FAIL（${failures.length} 项）:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[unit] OK — ${passed} 项断言全部通过（碰撞/开火解算/数值衰减/库存/解锁链/出生点/滚轮顺序/房间状态机）`);
}

main().catch((err) => {
  console.error('[unit] failed:', err);
  process.exit(1);
});
