#!/bin/bash

# 일일 아카이빙 스크립트
# 90일 이상 된 데이터를 아카이브 테이블로 이동

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs/archive"
LOG_FILE="$LOG_DIR/archive_$(date +%Y%m%d).log"

# 로그 디렉토리 생성
mkdir -p "$LOG_DIR"

# 로깅 함수
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 데이터베이스 연결 정보
export PGPASSWORD="Tech1324!"
DB_HOST="mkt.techb.kr"
DB_PORT="5432"
DB_NAME="coupang_test"
DB_USER="techb_pp"

log "========================================="
log "일일 아카이빙 작업 시작"
log "========================================="

# 1. 현재 테이블 크기 확인
log "현재 테이블 크기 확인..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) as size,
    n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public' 
    AND tablename IN ('v1_hub_work_allocations', 'v1_hub_client_activity_logs', 'v1_hub_proxy_toggle_logs')
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
EOF

# 2. 아카이빙 대상 건수 확인
log "아카이빙 대상 확인..."
ARCHIVE_COUNT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
    SELECT COUNT(*) 
    FROM v1_hub_work_allocations 
    WHERE work_date < CURRENT_DATE - INTERVAL '90 days';
")

log "아카이빙 대상: $ARCHIVE_COUNT 건"

if [ "$ARCHIVE_COUNT" -gt 0 ]; then
    # 3. work_allocations 아카이빙 실행
    log "work_allocations 아카이빙 시작..."
    
    RESULT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t << EOF
    SELECT * FROM archive_old_work_allocations();
EOF
    )
    
    log "아카이빙 결과: $RESULT"
    
    # 4. client_activity_logs 아카이빙
    log "client_activity_logs 아카이빙 시작..."
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
    BEGIN;
    INSERT INTO v1_hub_client_activity_logs_archive
    SELECT * FROM v1_hub_client_activity_logs
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    DELETE FROM v1_hub_client_activity_logs
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    COMMIT;
EOF
    
    # 5. proxy_toggle_logs 아카이빙
    log "proxy_toggle_logs 아카이빙 시작..."
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
    BEGIN;
    INSERT INTO v1_hub_proxy_toggle_logs_archive
    SELECT * FROM v1_hub_proxy_toggle_logs
    WHERE toggled_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    DELETE FROM v1_hub_proxy_toggle_logs
    WHERE toggled_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    COMMIT;
EOF
else
    log "아카이빙할 데이터가 없습니다."
fi

# 6. 일별 통계 업데이트
log "일별 통계 업데이트..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
-- 어제 통계 업데이트
SELECT update_daily_stats(CURRENT_DATE - INTERVAL '1 day');

-- 오늘 통계 업데이트
SELECT update_daily_stats(CURRENT_DATE);
EOF

# 7. VACUUM 실행 (공간 회수)
log "VACUUM 실행..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
VACUUM ANALYZE v1_hub_work_allocations;
VACUUM ANALYZE v1_hub_client_activity_logs;
VACUUM ANALYZE v1_hub_proxy_toggle_logs;
EOF

# 8. 아카이빙 후 테이블 크기 확인
log "아카이빙 후 테이블 크기..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF >> "$LOG_FILE" 2>&1
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) as size,
    n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public' 
    AND tablename IN ('v1_hub_work_allocations', 'v1_hub_client_activity_logs', 'v1_hub_proxy_toggle_logs')
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
EOF

# 9. 디스크 사용량 체크
log "디스크 사용량 체크..."
df -h | grep -E "^/dev/" >> "$LOG_FILE"

# 10. 오래된 로그 파일 정리 (30일 이상)
log "오래된 로그 파일 정리..."
find "$LOG_DIR" -name "*.log" -mtime +30 -exec rm {} \; 2>/dev/null
DELETED_COUNT=$(find "$LOG_DIR" -name "*.log" -mtime +30 2>/dev/null | wc -l)
log "삭제된 로그 파일: $DELETED_COUNT 개"

log "========================================="
log "일일 아카이빙 작업 완료"
log "========================================="

# 실패 시 알림 (옵션)
if [ $? -ne 0 ]; then
    echo "아카이빙 실패! 로그를 확인하세요: $LOG_FILE" | mail -s "Hub Server Archive Failed" admin@example.com 2>/dev/null
fi