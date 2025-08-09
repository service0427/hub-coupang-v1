-- Phase 1: 프록시 관련 테이블 통합
-- 실행일: 2025-08-09
-- 목표: 4개 테이블 → 1개로 통합

-- ============================================================================
-- 1. v1_hub_proxies 테이블 확장
-- ============================================================================

-- 새 컬럼 추가
ALTER TABLE v1_hub_proxies 
ADD COLUMN IF NOT EXISTS ip_history JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS heartbeat_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS usage_stats JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS total_allocations BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_toggles INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;

-- ============================================================================
-- 2. 기존 데이터 마이그레이션
-- ============================================================================

-- proxy_ip_mapping 데이터 통합
UPDATE v1_hub_proxies p
SET ip_history = COALESCE(
    (SELECT jsonb_agg(
        jsonb_build_object(
            'ip', m.current_ip,
            'assigned_at', m.last_toggle,
            'updated_at', m.updated_at
        ) ORDER BY m.updated_at DESC
    )
    FROM v1_hub_proxy_ip_mapping m
    WHERE m.proxy_id = p.id
    ), '[]'::jsonb
)
WHERE EXISTS (
    SELECT 1 FROM v1_hub_proxy_ip_mapping m 
    WHERE m.proxy_id = p.id
);

-- proxy_heartbeat 데이터 통합
UPDATE v1_hub_proxies p
SET 
    last_heartbeat_at = h.last_heartbeat,
    heartbeat_count = h.heartbeat_count
FROM (
    SELECT 
        proxy_id,
        MAX(heartbeat_time) as last_heartbeat,
        COUNT(*) as heartbeat_count
    FROM v1_hub_proxy_heartbeat
    GROUP BY proxy_id
) h
WHERE p.id = h.proxy_id;

-- proxy_usage 데이터 통합
UPDATE v1_hub_proxies p
SET usage_stats = jsonb_build_object(
    'total_uses', u.total_uses,
    'success_count', u.success_count,
    'fail_count', u.fail_count,
    'last_used', u.last_used_at,
    'avg_response_time_ms', u.avg_response_time_ms
),
total_allocations = u.total_uses
FROM (
    SELECT 
        proxy_id,
        COUNT(*) as total_uses,
        COUNT(*) FILTER (WHERE success = true) as success_count,
        COUNT(*) FILTER (WHERE success = false) as fail_count,
        MAX(used_at) as last_used_at,
        AVG(response_time_ms) as avg_response_time_ms
    FROM v1_hub_proxy_usage
    GROUP BY proxy_id
) u
WHERE p.id = u.proxy_id;

-- ============================================================================
-- 3. 통합 뷰 생성 (하위 호환성)
-- ============================================================================

-- proxy_ip_mapping 호환 뷰
CREATE OR REPLACE VIEW v1_hub_proxy_ip_mapping_view AS
SELECT 
    p.id as proxy_id,
    p.server_ip,
    p.port,
    p.external_ip as current_ip,
    p.last_toggle_at as last_toggle,
    p.updated_at,
    p.ip_history
FROM v1_hub_proxies p;

-- proxy 상태 종합 뷰
CREATE OR REPLACE VIEW v1_hub_proxy_status AS
SELECT 
    p.id,
    p.server_ip,
    p.port,
    p.status,
    p.external_ip,
    p.use_count,
    p.last_toggle_at,
    p.last_heartbeat_at,
    CASE 
        WHEN p.last_heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes' 
        THEN 'healthy'
        WHEN p.last_heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '30 minutes'
        THEN 'warning'
        ELSE 'dead'
    END as health_status,
    p.usage_stats->>'total_uses' as total_uses,
    p.usage_stats->>'success_count' as success_count,
    ROUND(
        100.0 * (p.usage_stats->>'success_count')::numeric / 
        NULLIF((p.usage_stats->>'total_uses')::numeric, 0), 
        2
    ) as success_rate
FROM v1_hub_proxies p;

-- ============================================================================
-- 4. 테이블 삭제 준비 (백업 후 실행)
-- ============================================================================

-- 백업 테이블 생성
CREATE TABLE IF NOT EXISTS backup_proxy_tables AS
SELECT 
    'proxy_ip_mapping' as source_table,
    now() as backup_time,
    row_to_json(m.*) as data
FROM v1_hub_proxy_ip_mapping m
UNION ALL
SELECT 
    'proxy_heartbeat',
    now(),
    row_to_json(h.*)
FROM v1_hub_proxy_heartbeat h
UNION ALL
SELECT 
    'proxy_usage',
    now(),
    row_to_json(u.*)
FROM v1_hub_proxy_usage u;

-- 통계 출력
DO $$
DECLARE
    v_mapping_count INTEGER;
    v_heartbeat_count INTEGER;
    v_usage_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_mapping_count FROM v1_hub_proxy_ip_mapping;
    SELECT COUNT(*) INTO v_heartbeat_count FROM v1_hub_proxy_heartbeat;
    SELECT COUNT(*) INTO v_usage_count FROM v1_hub_proxy_usage;
    
    RAISE NOTICE '';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ Phase 1: 프록시 테이블 통합 완료';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '통합된 데이터:';
    RAISE NOTICE '- IP 매핑: %건', v_mapping_count;
    RAISE NOTICE '- 하트비트: %건', v_heartbeat_count;
    RAISE NOTICE '- 사용 통계: %건', v_usage_count;
    RAISE NOTICE '';
    RAISE NOTICE '다음 단계:';
    RAISE NOTICE '1. 애플리케이션 코드 테스트';
    RAISE NOTICE '2. 문제 없으면 기존 테이블 삭제:';
    RAISE NOTICE '   DROP TABLE v1_hub_proxy_ip_mapping;';
    RAISE NOTICE '   DROP TABLE v1_hub_proxy_heartbeat;';
    RAISE NOTICE '   DROP TABLE v1_hub_proxy_usage;';
    RAISE NOTICE '=============================================';
END $$;

-- ============================================================================
-- 5. 인덱스 최적화
-- ============================================================================

-- 새로운 JSONB 인덱스
CREATE INDEX IF NOT EXISTS idx_proxies_usage_stats 
ON v1_hub_proxies USING gin (usage_stats);

CREATE INDEX IF NOT EXISTS idx_proxies_ip_history 
ON v1_hub_proxies USING gin (ip_history);

CREATE INDEX IF NOT EXISTS idx_proxies_heartbeat 
ON v1_hub_proxies (last_heartbeat_at DESC)
WHERE last_heartbeat_at IS NOT NULL;