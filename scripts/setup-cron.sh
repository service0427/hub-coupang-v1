#!/bin/bash

# 크론 작업 설정 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "크론 작업 설정 시작..."

# 실행 권한 부여
chmod +x "$SCRIPT_DIR/daily-archive.sh"
chmod +x "$SCRIPT_DIR/weekly-backup.sh" 2>/dev/null
chmod +x "$SCRIPT_DIR/monthly-partition.sh" 2>/dev/null

# 현재 크론탭 백업
crontab -l > /tmp/current_cron_backup.txt 2>/dev/null

# 새 크론 작업 추가
(
    # 기존 크론탭 유지 (허브 서버 관련 제외)
    crontab -l 2>/dev/null | grep -v "hub-coupang" | grep -v "daily-archive" | grep -v "weekly-backup" | grep -v "monthly-partition"
    
    # 새 크론 작업 추가
    echo ""
    echo "# Hub Server 자동 유지보수 작업"
    echo "# 매일 새벽 3시 - 90일 이상 데이터 아카이빙"
    echo "0 3 * * * $SCRIPT_DIR/daily-archive.sh >> $SCRIPT_DIR/../logs/cron.log 2>&1"
    echo ""
    echo "# 매주 일요일 새벽 4시 - 전체 백업 (추후 구현)"
    echo "#0 4 * * 0 $SCRIPT_DIR/weekly-backup.sh >> $SCRIPT_DIR/../logs/cron.log 2>&1"
    echo ""
    echo "# 매월 1일 새벽 2시 - 파티션 관리 (추후 구현)"
    echo "#0 2 1 * * $SCRIPT_DIR/monthly-partition.sh >> $SCRIPT_DIR/../logs/cron.log 2>&1"
    echo ""
    echo "# 매시간 - 일별 통계 업데이트"
    echo "0 * * * * psql -U techb_pp -h mkt.techb.kr -d coupang_test -c \"SELECT update_daily_stats();\" >> $SCRIPT_DIR/../logs/stats.log 2>&1"
    echo ""
) | crontab -

echo "크론 작업 설정 완료!"
echo ""
echo "현재 설정된 크론 작업:"
crontab -l | grep -A5 "Hub Server"

echo ""
echo "크론 로그 확인: tail -f $SCRIPT_DIR/../logs/cron.log"
echo "백업 파일: /tmp/current_cron_backup.txt"