#!/bin/bash

# 프로덕션 서버 시작 스크립트
# Production server start script

echo "🚀 허브 서버 시작 중..."

# PM2로 서버 시작
pm2 start ecosystem.config.js

# 상태 확인
pm2 status

echo "✅ 서버가 시작되었습니다."
echo "📊 모니터링: pm2 monit"
echo "📋 로그 확인: pm2 logs hub-server"
echo "🛑 종료: pm2 stop hub-server"