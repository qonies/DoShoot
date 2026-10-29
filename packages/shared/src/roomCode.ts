/** 房间号（FR-L8）：4 位纯数字，人类可读、便于局域网口头传递。
 *  生成与校验逻辑前后端同源——客户端先行校验给即时反馈，服务端再做权威校验。 */

/** 房间号位数 */
export const ROOM_CODE_LENGTH = 4;

/** 规范化用户输入的房间号：去空白/分隔符后必须为恰好 4 位纯数字；非法返回 null */
export function normalizeRoomCode(raw: string): string | null {
  const s = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\d{4}$/.test(s) ? s : null;
}