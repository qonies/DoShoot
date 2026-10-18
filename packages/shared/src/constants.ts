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

/** 玩家生命上限（FR-C3：HP 100，V1 不做护甲） */
export const PLAYER_HP = 100;
/** 死亡后重生延迟（秒，FR-C4：2~3s） */
export const RESPAWN_DELAY = 2.5;
/** 命中判定盒半边长（略大于碰撞半径，命中手感从宽） */
export const HITBOX_HALF = 0.45;

/** 网络协议版本（见 FR-N7） */
export const PROTOCOL_VERSION = 1;
/** 服务端固定步长模拟频率（见 FR-N2） */
export const SIM_TICK_RATE = 30;
/** 快照下发频率下/上限 */
export const SNAPSHOT_RATE_MIN = 20;
export const SNAPSHOT_RATE_MAX = 30;
/** 房间人数上限（FFA 玩家数，FR-N6） */
export const ROOM_CAPACITY = 10;
/** 房间 Bot 自动填充上限（FR-B1） */
export const BOT_FILL_MAX = 5;
