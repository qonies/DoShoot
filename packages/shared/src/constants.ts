/** 全局数值常量（前后端同源，禁止两端各自定义） */

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
export const PROTOCOL_VERSION = 2;
/** 服务端固定步长模拟频率（见 FR-N2） */
export const SIM_TICK_RATE = 30;
/** 快照广播频率下/上限（Hz）：广播间隔 = 1000/MAX（每次唤醒聚合多步事件），下限由冒烟断言校验 */
export const SNAPSHOT_RATE_MIN = 20;
export const SNAPSHOT_RATE_MAX = 30;
/** 房间人数上限（FFA 玩家数，FR-N6） */
export const ROOM_CAPACITY = 10;
/** 房间 Bot 自动填充上限（FR-B1） */
export const BOT_FILL_MAX = 5;

/** Bot AI 三档难度（FR-B3，大厅可选，默认中等） */
export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** 对局结束条件默认值（FR-M1）：先到 30 杀或 5 分钟时限 */
export const MATCH_KILL_TARGET = 30;
export const MATCH_TIME_LIMIT = 300;
/** 对局生命周期可选项（FR-L7）：大厅可选击杀目标与时限，先到即结束；默认值即上面两项 */
export const KILL_TARGET_OPTIONS: readonly number[] = [30, 50, 100];
export const TIME_LIMIT_OPTIONS: readonly number[] = [300, 480, 600];
/** 断线重连宽限（秒，FR-N5）：超时视为离开并移除 */
export const RECONNECT_GRACE = 30;
/** 空房间回收（毫秒，FR-N6） */
export const ROOM_RECYCLE_MS = 60_000;

/** 冲锋枪彩蛋模式口令（FR-E1）：对局中依次输入该 4 位数字 + Enter 激活——
 *  高射速 / 远射程 / 无限弹药的特殊冲锋枪，仅当局有效（对局结束/下一局自动失效）。
 *  特意选用不含 1~6 的数字组合：1~6 是切枪热键，输入口令过程不误触切枪。 */
export const CHEAT_RUSH_CODE = '7890';

/** 远端实体插值缓冲延迟（秒，FR-N3）：客户端 entities.ts 同源消费，也是 M4 延迟补偿回溯的基准分量 */
export const INTERP_DELAY = 0.1;
/** 延迟补偿（FR-N4，M4）：服务端实体位置历史时长（秒）与单次回溯上限（秒） */
export const LAG_COMP_HISTORY = 1;
export const LAG_COMP_MAX_REWIND = 0.4;
