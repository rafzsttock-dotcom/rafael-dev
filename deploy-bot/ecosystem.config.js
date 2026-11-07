export default {
  apps: [{
    name: 'deploy-bot',
    script: 'src/index.js',
    restart_delay: 3000,
    max_restarts: 10
  }]
}
