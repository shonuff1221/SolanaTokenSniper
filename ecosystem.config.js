module.exports = {
  apps: [
    {
      name: 'n8nAi',
      script: './dist/n8nAi.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/n8nAi-error.log',
      out_file: './logs/n8nAi-out.log',
      merge_logs: true,
    },
    {
      name: 'webhookReceiver',
      script: './dist/webhookReceiver.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/webhookReceiver-error.log',
      out_file: './logs/webhookReceiver-out.log',
      merge_logs: true,
    }
  ]
};
