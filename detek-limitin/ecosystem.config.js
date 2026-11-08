module.exports = {
  apps: [
    {
      name: 'bot-cekbio',
      script: 'index.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '1G',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5055
      }
    }
  ]
};
