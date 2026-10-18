/** Socket.IO 连接封装（强制 websocket-only，见 techContext；消息类型来自 shared/protocol） */

import { io, type Socket } from 'socket.io-client';
import type {
  InputMsg,
  JoinMsg,
  JoinRejectedMsg,
  SnapshotMsg,
  WelcomeMsg,
} from '@deadshot/shared';

export interface NetHandlers {
  onWelcome(msg: WelcomeMsg): void;
  /** 快照监听（也可后续经 net.socket.on('snapshot') 注册） */
  onSnapshot?(msg: SnapshotMsg): void;
  onRejected(reason: JoinRejectedMsg['reason']): void;
  onDisconnected(): void;
}

export class Net {
  readonly socket: Socket;

  constructor(private readonly handlers: NetHandlers) {
    this.socket = io('/', { transports: ['websocket'] });
    this.socket.on('welcome', (m: WelcomeMsg) => this.handlers.onWelcome(m));
    if (this.handlers.onSnapshot) {
      this.socket.on('snapshot', (m: SnapshotMsg) => this.handlers.onSnapshot!(m));
    }
    this.socket.on('joinRejected', (m: JoinRejectedMsg) => this.handlers.onRejected(m?.reason ?? 'version'));
    this.socket.on('disconnect', () => this.handlers.onDisconnected());
  }

  join(msg: JoinMsg): void {
    this.socket.emit('join', msg);
  }

  sendInput(msg: InputMsg): void {
    this.socket.emit('input', msg);
  }

  close(): void {
    this.socket.close();
  }
}