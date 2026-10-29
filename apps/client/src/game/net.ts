/** Socket.IO 连接封装（强制 websocket-only，见 techContext；消息类型来自 shared/protocol）。
 *  M4：ping/pong 周期测量 RTT（FR-N4 延迟补偿回溯），随输入上报 pingMs。
 *  FR-L8 等待房间：createRoom（新建游戏）/updateRoom（房主调参）/startMatch（房主开局）
 *  + onRoomUpdate（等待界面实时同步）。 */

import { io, type Socket } from 'socket.io-client';
import type {
  CreateRoomMsg,
  InputMsg,
  JoinMsg,
  JoinRejectedMsg,
  RoomInfoMsg,
  RoomSettingsMsg,
  RushModeMsg,
  WelcomeMsg,
} from '@DoShoot/shared';

export interface NetHandlers {
  onWelcome(msg: WelcomeMsg): void;
  onRejected(reason: JoinRejectedMsg['reason']): void;
  /** 等待房间信息更新（FR-L8）：加入/离开/改参数/换房主/开局 */
  onRoomUpdate(msg: RoomInfoMsg): void;
  onDisconnected(): void;
  /** 连接失败（服务端未启动/网络不可达）。socket.io 默认无限重试，由上层决定是否 close */
  onConnectError(): void;
}

const PING_INTERVAL_MS = 2000;

export class Net {
  readonly socket: Socket;
  /** 最近平滑 RTT（ms，指数滑动平均）；未测得为 0 */
  private rtt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly handlers: NetHandlers) {
    this.socket = io('/', { transports: ['websocket'] });
    this.socket.on('connect', () => this.startPing());
    this.socket.on('pong', (t: number) => {
      const sample = Date.now() - Number(t);
      if (Number.isFinite(sample) && sample >= 0 && sample < 5000) {
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3;
      }
    });
    this.socket.on('welcome', (m: WelcomeMsg) => this.handlers.onWelcome(m));
    this.socket.on('joinRejected', (m: JoinRejectedMsg) => this.handlers.onRejected(m?.reason ?? 'version'));
    this.socket.on('roomUpdate', (m: RoomInfoMsg) => {
      if (m && typeof m === 'object') this.handlers.onRoomUpdate(m);
    });
    this.socket.on('disconnect', () => this.handlers.onDisconnected());
    this.socket.on('connect_error', () => this.handlers.onConnectError());
  }

  /** 建连后开始周期性 RTT 测量（FR-N4 延迟补偿回溯用） */
  private startPing(): void {
    if (this.pingTimer !== null) return;
    this.socket.emit('ping', Date.now()); // 立即测量一次
    this.pingTimer = setInterval(() => this.socket.emit('ping', Date.now()), PING_INTERVAL_MS);
  }

  /** 最近平滑 RTT（ms；未测得为 0） */
  get pingMs(): number {
    return Math.round(this.rtt);
  }

  join(msg: JoinMsg): void {
    this.socket.emit('join', msg);
  }

  /** 新建游戏（FR-L8 等待房间）：建房进入等待态，本人为房主 */
  createRoom(msg: CreateRoomMsg): void {
    this.socket.emit('createRoom', msg);
  }

  /** 房主调整等待房间参数（FR-L8）：服务端白名单校验 + 房主权限校验 */
  updateRoom(msg: RoomSettingsMsg): void {
    this.socket.emit('updateRoom', msg);
  }

  /** 房主开局（FR-L8）：全员收到重发的 welcome（room.state='running'）进入对局 */
  startMatch(): void {
    this.socket.emit('startMatch');
  }

  sendInput(msg: InputMsg): void {
    msg.pingMs = this.pingMs; // 延迟补偿回溯（FR-N4，M4）
    this.socket.emit('input', msg);
  }

  /** 再来一局（FR-M4，仅对局结束后由结算面板触发） */
  sendRematch(): void {
    this.socket.emit('rematch');
  }

  /** 冲锋枪彩蛋模式口令上报（FR-E1）：服务端校验 CHEAT_RUSH_CODE 后授予，仅当局有效 */
  sendRush(code: string): void {
    this.socket.emit('rush', { code } satisfies RushModeMsg);
  }

  /** 主动离开对局（返回大厅）：服务端立即移除实体，不走 30s 断线宽限（FR-N5/N6 语义区分） */
  sendLeave(): void {
    this.socket.emit('leave');
  }

  close(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.socket.close();
  }
}