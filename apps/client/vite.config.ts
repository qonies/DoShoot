import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // 开发态代理：客户端 io('/') 直连页面来源（5173），socket.io（websocket-only）转发到本机游戏服务端
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: { target: 'esnext' },
});
