module.exports = {
  apps: [
    {
      name: 'hub-coupang-v1',
      script: './src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        TOGGLE_COOLDOWN_MS: process.env.TOGGLE_COOLDOWN_MS || '31000'
      },
      env_production: {
        NODE_ENV: 'production',
        TOGGLE_COOLDOWN_MS: process.env.TOGGLE_COOLDOWN_MS || '31000'
      }
    },
    {
      name: 'continuous-test',
      script: './continuous-test.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      cron_restart: '0 */6 * * *', // 6시간마다 재시작
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};