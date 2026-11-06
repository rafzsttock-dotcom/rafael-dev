// PM2 config — jalankan dengan: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "cogil-portfolio",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
    },
  ],
};
