/**
 * PM2 Ecosystem Config
 * 
 * รัน: pm2 start ecosystem.config.js
 * หยุด: pm2 stop all
 * ดู log: pm2 logs
 * เปิด dashboard: pm2 monit
 */

module.exports = {
  apps: [
    // 1. Next.js server (Dashboard UI + API routes)
    {
      name: "alpacha-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      out_file: "./logs/web-out.log",
      error_file: "./logs/web-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss TZ",
    },

    // 2. WebSocket Streaming Worker (PRIMARY — real-time)
    {
      name: "alpacha-stream",
      script: "scripts/streaming-worker.js",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        WORKER_DRY_RUN: "false",       // 🔴 LIVE trading
        WORKER_BASE_URL: "http://localhost:3000",
      },
      autorestart: true,
      max_restarts: 100,       // streaming can reconnect many times
      restart_delay: 5000,
      exp_backoff_restart_delay: 500,
      out_file: "./logs/stream-out.log",
      error_file: "./logs/stream-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss TZ",
      merge_logs: true,
    },

    // 3. Polling Worker (BACKUP — runs when streaming reconnects)
    {
      name: "alpacha-poll",
      script: "scripts/auto-trader-worker.js",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        WORKER_DRY_RUN: "false",
        WORKER_BASE_URL: "http://localhost:3000",
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 10000,
      exp_backoff_restart_delay: 100,
      out_file: "./logs/poll-out.log",
      error_file: "./logs/poll-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss TZ",
      merge_logs: true,
    },
  ],
}
