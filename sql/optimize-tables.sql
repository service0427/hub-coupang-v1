-- 테이블 구조 최적화 및 검증
-- 실행일: 2025-08-09

-- ============================================================================
-- 1. 테이블 구조 분석
-- ============================================================================

-- 현재 테이블 크기 확인
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public' 
    AND tablename LIKE 'v1_hub_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================================================
-- 2. 누락된 인덱스 추가
-- ============================================================================

-- v1_hub_work_slots 최적화
CREATE INDEX IF NOT EXISTS idx_work_slots_site_status_date
ON v1_hub_work_slots (site, status, start_date, end_date)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_work_slots_code_unique
ON v1_hub_work_slots (code)
WHERE code IS NOT NULL;

-- v1_hub_work_allocations 최적화
CREATE INDEX IF NOT EXISTS idx_allocations_work_date
ON v1_hub_work_allocations (work_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_allocations_client_work
ON v1_hub_work_allocations (client_ip, work_date, status)
WHERE status IN ('allocated', 'completed');

-- v1_hub_proxies 최적화
CREATE INDEX IF NOT EXISTS idx_proxies_active_use_count
ON v1_hub_proxies (status, use_count)
WHERE status = 'active' AND use_count < 20;

CREATE INDEX IF NOT EXISTS idx_proxies_toggle_needed
ON v1_hub_proxies (last_toggle_at, use_count)
WHERE status = 'active' AND use_count >= 18;

-- v1_hub_external_triggers 최적화
CREATE INDEX IF NOT EXISTS idx_triggers_site_date
ON v1_hub_external_triggers (site_id, created_at DESC);

-- v1_hub_daily_work_tracking 최적화
CREATE INDEX IF NOT EXISTS idx_daily_tracking_date_slot
ON v1_hub_daily_work_tracking (work_date DESC, work_slot_id);

-- ============================================================================
-- 3. 제약 조건 추가/수정
-- ============================================================================

-- v1_hub_work_slots 제약 조건
ALTER TABLE v1_hub_work_slots
ADD CONSTRAINT IF NOT EXISTS chk_dates CHECK (start_date <= end_date),
ADD CONSTRAINT IF NOT EXISTS chk_daily_count CHECK (daily_work_count >= 0);

-- code 컬럼 유니크 제약 (없으면 추가)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_work_slot_code'
    ) THEN
        ALTER TABLE v1_hub_work_slots 
        ADD CONSTRAINT unique_work_slot_code UNIQUE (code);
    END IF;
END $$;

-- v1_hub_work_allocations 제약 조건
ALTER TABLE v1_hub_work_allocations
ADD CONSTRAINT IF NOT EXISTS chk_allocation_status 
CHECK (status IN ('allocated', 'completed', 'expired', 'failed'));

-- v1_hub_proxies 제약 조건
ALTER TABLE v1_hub_proxies
ADD CONSTRAINT IF NOT EXISTS chk_proxy_status 
CHECK (status IN ('active', 'inactive', 'maintenance')),
ADD CONSTRAINT IF NOT EXISTS chk_use_count CHECK (use_count >= 0);

-- ============================================================================
-- 4. 파티셔닝 준비 (대용량 테이블)
-- ============================================================================

-- v1_hub_work_allocations 파티셔닝 (월별)
-- 주석: 데이터가 더 많아지면 파티셔닝 적용
/*
CREATE TABLE v1_hub_work_allocations_2025_08 PARTITION OF v1_hub_work_allocations
FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE v1_hub_work_allocations_2025_09 PARTITION OF v1_hub_work_allocations
FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
*/

-- ============================================================================
-- 5. 통계 업데이트 및 VACUUM
-- ============================================================================

-- 통계 업데이트
ANALYZE v1_hub_work_slots;
ANALYZE v1_hub_work_allocations;
ANALYZE v1_hub_proxies;
ANALYZE v1_hub_daily_work_tracking;
ANALYZE v1_hub_external_triggers;

-- VACUUM (공간 회수)
VACUUM (ANALYZE) v1_hub_work_slots;
VACUUM (ANALYZE) v1_hub_work_allocations;
VACUUM (ANALYZE) v1_hub_proxies;

-- ============================================================================
-- 6. 느린 쿼리 최적화를 위한 뷰
-- ============================================================================

-- 활성 작업 슬롯 빠른 조회
CREATE OR REPLACE VIEW v1_hub_active_work_slots AS
SELECT 
    ws.id,
    ws.keyword,
    ws.code,
    ws.site,
    ws.extra_config,
    ws.cart_click_enabled,
    dwt.target_count,
    dwt.allocated_count,
    dwt.completed_count,
    dwt.failed_count,
    CASE 
        WHEN dwt.target_count > 0 
        THEN ROUND(100.0 * dwt.completed_count / dwt.target_count, 2)
        ELSE 0 
    END as completion_rate
FROM v1_hub_work_slots ws
LEFT JOIN v1_hub_daily_work_tracking dwt 
    ON ws.id = dwt.work_slot_id 
    AND dwt.work_date = CURRENT_DATE
WHERE ws.status = 'active'
    AND ws.start_date <= CURRENT_DATE
    AND ws.end_date >= CURRENT_DATE;

-- 프록시 상태 대시보드
CREATE OR REPLACE VIEW v1_hub_proxy_dashboard AS
SELECT 
    COUNT(*) as total_proxies,
    COUNT(*) FILTER (WHERE status = 'active') as active_proxies,
    COUNT(*) FILTER (WHERE status = 'active' AND use_count < 20) as available_proxies,
    COUNT(*) FILTER (WHERE status = 'active' AND use_count >= 18) as need_toggle_soon,
    COUNT(*) FILTER (WHERE status = 'active' AND use_count >= 20) as need_toggle_now,
    ROUND(AVG(use_count) FILTER (WHERE status = 'active'), 2) as avg_use_count,
    MIN(last_toggle_at) FILTER (WHERE status = 'active') as oldest_toggle
FROM v1_hub_proxies;

-- ============================================================================
-- 7. 불필요한 데이터 정리
-- ============================================================================

-- 7일 이상 된 expired 할당 삭제
DELETE FROM v1_hub_work_allocations
WHERE status = 'expired' 
    AND work_date < CURRENT_DATE - INTERVAL '7 days';

-- 30일 이상 된 트리거 로그 삭제
DELETE FROM v1_hub_external_triggers
WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';

-- ============================================================================
-- 8. 함수 최적화
-- ============================================================================

-- 작업 할당 가능 여부 빠른 체크
CREATE OR REPLACE FUNCTION check_allocation_available(
    p_work_slot_id INTEGER,
    p_work_date DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN AS $$
DECLARE
    v_available BOOLEAN;
BEGIN
    SELECT 
        CASE 
            WHEN dwt.allocated_count < dwt.target_count THEN true
            ELSE false
        END INTO v_available
    FROM v1_hub_daily_work_tracking dwt
    WHERE dwt.work_slot_id = p_work_slot_id
        AND dwt.work_date = p_work_date;
    
    RETURN COALESCE(v_available, true);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. 테이블 정리 및 최적화 결과
-- ============================================================================

DO $$
DECLARE
    v_total_size TEXT;
    v_index_count INTEGER;
    v_constraint_count INTEGER;
BEGIN
    -- 전체 데이터베이스 크기
    SELECT pg_size_pretty(pg_database_size(current_database())) 
    INTO v_total_size;
    
    -- 인덱스 수
    SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename LIKE 'v1_hub_%';
    
    -- 제약조건 수
    SELECT COUNT(*) INTO v_constraint_count
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' 
        AND c.conrelid::regclass::text LIKE 'v1_hub_%';
    
    RAISE NOTICE '';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ 테이블 최적화 완료!';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '데이터베이스 크기: %', v_total_size;
    RAISE NOTICE '인덱스 수: %', v_index_count;
    RAISE NOTICE '제약조건 수: %', v_constraint_count;
    RAISE NOTICE '';
    RAISE NOTICE '최적화 항목:';
    RAISE NOTICE '1. 인덱스 추가 및 최적화';
    RAISE NOTICE '2. 제약조건 강화';
    RAISE NOTICE '3. 통계 업데이트 및 VACUUM 실행';
    RAISE NOTICE '4. 최적화된 뷰 생성';
    RAISE NOTICE '5. 오래된 데이터 정리';
    RAISE NOTICE '=============================================';
END $$;