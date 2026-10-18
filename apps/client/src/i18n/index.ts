/** 自研轻量 i18n（FR-L6 / NFR-9）：JSON 资源 + 切换函数，默认跟随浏览器语言，localStorage 持久化 */

import zh from './zh.json';
import en from './en.json';

export type Lang = 'zh' | 'en';
type Dict = Record<string, string>;

const resources: Record<Lang, Dict> = { zh, en };
const STORAGE_KEY = 'deadshot.lang';

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang: Lang = detectLang();

export function getLang(): Lang {
  return lang;
}

export function t(key: string): string {
  return resources[lang][key] ?? resources.en[key] ?? key;
}

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
  applyDom();
}

export function toggleLang(): Lang {
  setLang(lang === 'zh' ? 'en' : 'zh');
  return lang;
}

/** 将当前语言应用到所有带 data-i18n 属性的元素 */
export function applyDom(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}
