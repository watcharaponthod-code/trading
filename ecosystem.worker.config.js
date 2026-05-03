module.exports = {
  apps: [
    {
      name: "alpacha-stream",
      script: "scripts/streaming-worker.js",
      env: {
        NODE_ENV: "production",
        WORKER_DRY_RUN: "false",
        WORKER_BASE_URL: process.env.WORKER_BASE_URL || "https://trading-jet-iota.vercel.app",
      },
      autorestart: true,
      max_restarts: 100,
      restart_delay: 5000,
      exp_backoff_restart_delay: 500,
    },
    {
      name: "alpacha-poll",
      script: "scripts/auto-trader-worker.js",
      env: {
        NODE_ENV: "production",
        WORKER_DRY_RUN: "false",
        WORKER_BASE_URL: process.env.WORKER_BASE_URL || "https://trading-jet-iota.vercel.app",
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 10000,
    },
  ],
}
