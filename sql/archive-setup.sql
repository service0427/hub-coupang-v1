-- 아카이브 테이블 생성 및 자동 아카이빙 설정
-- 90일 이상 된 데이터를 자동으로 아카이브하고 원본에서 삭제

-- 1. 아카이브 테이블 생성
CREATE TABLE IF NOT EXISTS v1_hub_work_allocations_archive (
    LIKE v1_hub_work_allocations INCLUDING ALL
) WITH (
    autovacuum_enabled = false,
    toast_compression = 'pglz',
    fillfactor = 100
);

CREATE TABLE IF NOT EXISTS v1_hub_client_activity_logs_archive (
    LIKE v1_hub_client_activity_logs INCLUDING ALL  
) WITH (
    autovacuum_enabled = false,
    toast_compression = 'pglz',
    fillfactor = 100
);

CREATE TABLE IF NOT EXISTS v1_hub_proxy_toggle_logs_archive (
    LIKE v1_hub_proxy_toggle_logs INCLUDING ALL
) WITH (
    autovacuum_enabled = false,
    toast_compression = 'pglz',
    fillfactor = 100
);

-- 2. 아카이빙 상태 추적 테이블
CREATE TABLE IF NOT EXISTS v1_hub_archive_history (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    archived_date DATE NOT NULL,
    rows_archived BIGINT NOT NULL,
    rows_deleted BIGINT NOT NULL,
    archive_started_at TIMESTAMP NOT NULL,
    archive_completed_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'partial'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 일별 통계 테이블 (빠른 조회용)
CREATE TABLE IF NOT EXISTS v1_hub_daily_stats (
    stat_date DATE PRIMARY KEY,
    total_allocations BIGINT DEFAULT 0,
    completed_count BIGINT DEFAULT 0,
    expired_count BIGINT DEFAULT 0,
    failed_count BIGINT DEFAULT 0,
    avg_execution_time_ms INTEGER DEFAULT 0,
    unique_clients INTEGER DEFAULT 0,
    unique_keywords INTEGER DEFAULT 0,
    unique_proxies INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. 아카이빙 함수
CREATE OR REPLACE FUNCTION archive_old_work_allocations()
RETURNS TABLE(
    archived_count BIGINT,
    deleted_count BIGINT,
    execution_time_ms BIGINT
) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_archived_count BIGINT;
    v_deleted_count BIGINT;
    v_cutoff_date DATE;
BEGIN
    v_start_time := clock_timestamp();
    v_cutoff_date := CURRENT_DATE - INTERVAL '90 days';
    
    -- 트랜잭션 시작
    BEGIN
        -- 아카이브로 복사
        INSERT INTO v1_hub_work_allocations_archive
        SELECT * FROM v1_hub_work_allocations
        WHERE work_date < v_cutoff_date;
        
        GET DIAGNOSTICS v_archived_count = ROW_COUNT;
        
        -- 원본에서 삭제
        DELETE FROM v1_hub_work_allocations
        WHERE work_date < v_cutoff_date;
        
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        
        -- 아카이브 이력 기록
        INSERT INTO v1_hub_archive_history (
            table_name, archived_date, rows_archived, rows_deleted,
            archive_started_at, archive_completed_at, status
        ) VALUES (
            'v1_hub_work_allocations', 
            v_cutoff_date,
            v_archived_count,
            v_deleted_count,
            v_start_time,
            clock_timestamp(),
            'success'
        );
        
        -- 통계 업데이트
        ANALYZE v1_hub_work_allocations;
        
    EXCEPTION WHEN OTHERS THEN
        -- 오류 발생 시 롤백 및 기록
        INSERT INTO v1_hub_archive_history (
            table_name, archived_date, rows_archived, rows_deleted,
            archive_started_at, archive_completed_at, status, error_message
        ) VALUES (
            'v1_hub_work_allocations',
            v_cutoff_date,
            0,
            0,
            v_start_time,
            clock_timestamp(),
            'failed',
            SQLERRM
        );
        RAISE;
    END;
    
    RETURN QUERY
    SELECT 
        v_archived_count,
        v_deleted_count,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start_time))::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- 5. 일별 통계 집계 함수
CREATE OR REPLACE FUNCTION update_daily_stats(p_date DATE DEFAULT CURRENT_DATE)
RETURNS void AS $$
BEGIN
    INSERT INTO v1_hub_daily_stats (
        stat_date,
        total_allocations,
        completed_count,
        expired_count,
        failed_count,
        avg_execution_time_ms,
        unique_clients,
        unique_keywords,
        unique_proxies,
        success_rate
    )
    SELECT 
        p_date,
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'expired'),
        COUNT(*) FILTER (WHERE status = 'failed'),
        AVG(execution_time_ms)::INTEGER,
        COUNT(DISTINCT client_ip),
        COUNT(DISTINCT work_slot_id),
        COUNT(DISTINCT proxy_id),
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0), 2)
    FROM v1_hub_work_allocations
    WHERE work_date = p_date
    ON CONFLICT (stat_date) DO UPDATE SET
        total_allocations = EXCLUDED.total_allocations,
        completed_count = EXCLUDED.completed_count,
        expired_count = EXCLUDED.expired_count,
        failed_count = EXCLUDED.failed_count,
        avg_execution_time_ms = EXCLUDED.avg_execution_time_ms,
        unique_clients = EXCLUDED.unique_clients,
        unique_keywords = EXCLUDED.unique_keywords,
        unique_proxies = EXCLUDED.unique_proxies,
        success_rate = EXCLUDED.success_rate,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- 6. 최적화된 인덱스 (90일 이내 데이터만)
CREATE INDEX IF NOT EXISTS idx_allocations_recent 
ON v1_hub_work_allocations (work_date DESC, status)
WHERE work_date >= CURRENT_DATE - INTERVAL '90 days';

CREATE INDEX IF NOT EXISTS idx_allocations_active
ON v1_hub_work_allocations (allocation_key, expires_at)
WHERE status = 'allocated';

-- 7. 아카이브 테이블 인덱스 (최소한만)
CREATE INDEX IF NOT EXISTS idx_archive_work_date
ON v1_hub_work_allocations_archive (work_date DESC);

-- 8. 테이블 크기 모니터링 뷰
CREATE OR REPLACE VIEW v1_hub_table_sizes AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size,
    (SELECT COUNT(*) FROM information_schema.tables t WHERE t.table_schema = schemaname AND t.table_name = tablename) as row_estimate
FROM pg_tables
WHERE schemaname = 'public' 
    AND tablename LIKE 'v1_hub_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 9. 권한 설정
GRANT SELECT ON v1_hub_work_allocations_archive TO techb_pp;
GRANT SELECT ON v1_hub_daily_stats TO techb_pp;
GRANT SELECT ON v1_hub_table_sizes TO techb_pp;

COMMENT ON TABLE v1_hub_work_allocations_archive IS '90일 이상 된 작업 할당 아카이브';
COMMENT ON TABLE v1_hub_daily_stats IS '일별 통계 집계 테이블 (빠른 대시보드용)';
COMMENT ON TABLE v1_hub_archive_history IS '아카이빙 작업 이력';
COMMENT ON FUNCTION archive_old_work_allocations() IS '90일 이상 된 데이터 자동 아카이빙';
COMMENT ON FUNCTION update_daily_stats(DATE) IS '일별 통계 집계 업데이트';