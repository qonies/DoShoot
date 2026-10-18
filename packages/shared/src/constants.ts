/** 全局数值常量（前后端同源，禁止两端各自定义） */

/** 地图每格边长（世界单位） */
export const CELL_SIZE = 1;
/** 测试地图尺寸（格） */
export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 40;
/** 墙体高度（仅视觉，V1 碰撞全部按阻挡处理，见 FR-C5） */
export const WALL_HEIGHT = 1.6;

/** 玩家移速（世界单位/秒，见 FR-C1） */
export const PLAYER_SPEED = 6;
/** 玩家碰撞半径 */
export const PLAYER_RADIUS = 0.4;

/** M0 射击盒子用：开火间隔（秒） */
export const FIRE_INTERVAL = 0.15;
/** 射线最大射程 */
export const MAX_RAY_DIST = 60;

/** 网络协议版本（见 FR-N7） */
export const PROTOCOL_VERSION = 1;
/** 服务端固定步长模拟频率（见 FR-N2） */
export const SIM_TICK_RATE = 30;
/** 快照下发频率下/上限 */
export const SNAPSHOT_RATE_MIN = 20;
export const SNAPSHOT_RATE_MAX = 30;
