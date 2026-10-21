/** i18n 全量校对（NFR-9，M4）：zh/en 键集一致性 + 代码引用键（t('…') / data-i18n="…"）覆盖率
 *  + 动态键前缀（weapon.* 全层级 / map.*）核对。运行：corepack pnpm check:i18n（退出码 0 = 通过） */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_ORDER } from '@DoShoot/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'apps', 'client');
const i18nDir = path.join(clientDir, 'src', 'i18n');
const zh = JSON.parse(readFileSync(path.join(i18nDir, 'zh.json'), 'utf8')) as Record<string, string>;
const en = JSON.parse(readFileSync(path.join(i18nDir, 'en.json'), 'utf8')) as Record<string, string>;

const problems: string[] = [];

// 1) zh/en 键集一致
for (const k of Object.keys(zh)) if (!(k in en)) problems.push(`en 缺少键: ${k}`);
for (const k of Object.keys(en)) if (!(k in zh)) problems.push(`zh 缺少键: ${k}`);

// 2) 代码引用键核对（src/**/*.ts 的 t('…')/t("…") + index.html 与 ts 的 data-i18n="…"）
const used = new Set<string>();
const scan = (src: string): void => {
  for (const m of src.matchAll(/\bt\('([^']+)'\)/g)) used.add(m[1]!);
  for (const m of src.matchAll(/\bt\("([^"]+)"\)/g)) used.add(m[1]!);
  for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]!);
  // 间接引用：文案键经变量传入 t() 的包装函数（如 showNetMsg(key)）——
  // 此前只扫 t('…') 导致 lobby.nameInvalid 缺键漏检（实际显示原始 key）
  for (const m of src.matchAll(/\bshowNetMsg\('([^']+)'\)/g)) used.add(m[1]!);
  for (const m of src.matchAll(/\bshowNetMsg\("([^"]+)"\)/g)) used.add(m[1]!);
};
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|html)$/.test(name)) scan(readFileSync(p, 'utf8'));
  }
};
walk(path.join(clientDir, 'src'));
scan(readFileSync(path.join(clientDir, 'index.html'), 'utf8'));

for (const k of used) {
  if (!(k in zh)) problems.push(`代码引用但 zh 缺少: ${k}`);
  if (!(k in en)) problems.push(`代码引用但 en 缺少: ${k}`);
}

// 3) 动态键核对：weapon.<id> 与 weapon.<id>.t2/t3（击杀流/解锁横幅/HUD 名）、map.<id>（地图下拉）
for (const id of WEAPON_ORDER) {
  for (const suffix of ['', '.t2', '.t3']) {
    const k = `weapon.${id}${suffix}`;
    if (!(k in zh) || !(k in en)) problems.push(`动态武器键缺失: ${k}`);
  }
}
for (const k of Object.keys(zh)) {
  if (k.startsWith('map.') && !(k in en)) problems.push(`en 缺少地图键: ${k}`);
}

if (problems.length > 0) {
  console.error(`[check:i18n] FAIL（${problems.length} 处）:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`[check:i18n] OK — zh/en 各 ${Object.keys(zh).length} 键一致；代码静态引用 ${used.size} 键全部覆盖；动态武器/地图键完整`);
