-- 외부 사이트 트리거 관련 테이블

-- 1. 트리거 로그 테이블
CREATE TABLE IF NOT EXISTS v1_hub_external_triggers (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL, -- ADD, UPDATE, DELETE
    affected_count INTEGER DEFAULT 0,
    keywords JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_trigger_site_action 
ON v1_hub_external_triggers (site_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trigger_created 
ON v1_hub_external_triggers (created_at DESC);

-- 2. work_slots 테이블에 필요한 컬럼 추가
ALTER TABLE v1_hub_work_slots 
ADD COLUMN IF NOT EXISTS source VARCHAR(50),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(50);

-- deleted 상태 인덱스
CREATE INDEX IF NOT EXISTS idx_work_slots_deleted 
ON v1_hub_work_slots (status, deleted_at) 
WHERE status = 'deleted';

-- source 별 인덱스
CREATE INDEX IF NOT EXISTS idx_work_slots_source 
ON v1_hub_work_slots (source, status);

-- 3. 사이트별 키워드 통계 뷰
CREATE OR REPLACE VIEW v1_hub_site_keyword_stats AS
SELECT 
    source,
    COUNT(*) as total_keywords,
    COUNT(*) FILTER (WHERE status = 'active') as active_keywords,
    COUNT(*) FILTER (WHERE status = 'deleted') as deleted_keywords,
    COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') as added_24h,
    COUNT(*) FILTER (WHERE updated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' 
                      AND created_at <= CURRENT_TIMESTAMP - INTERVAL '24 hours') as updated_24h,
    COUNT(*) FILTER (WHERE deleted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') as deleted_24h,
    MIN(created_at) as first_keyword_at,
    MAX(created_at) as last_keyword_at,
    MAX(updated_at) as last_update_at
FROM v1_hub_work_slots
WHERE source IS NOT NULL
GROUP BY source;

-- 4. 트리거 활동 모니터링 뷰
CREATE OR REPLACE VIEW v1_hub_trigger_activity AS
SELECT 
    date_trunc('hour', created_at) as hour,
    site_id,
    action,
    COUNT(*) as trigger_count,
    SUM(affected_count) as total_affected
FROM v1_hub_external_triggers
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY date_trunc('hour', created_at), site_id, action
ORDER BY hour DESC, site_id;

-- 5. 사이트별 설정 테이블 (실제 운영용)
CREATE TABLE IF NOT EXISTS v1_hub_external_sites (
    site_id VARCHAR(50) PRIMARY KEY,
    site_name VARCHAR(200) NOT NULL,
    webhook_url VARCHAR(500),
    auth_key VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    last_trigger_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 기본 사이트 데이터 삽입
INSERT INTO v1_hub_external_sites (site_id, site_name, auth_key, config) VALUES
('SITE_A', '트렌드 모니터링 사이트', 'trend-monitor-key-2025', 
 '{"update_interval": 60000, "categories": ["패션", "뷰티", "전자제품", "생활용품"]}'),
('SITE_B', '가격 비교 사이트', 'price-compare-key-2025',
 '{"update_interval": 120000, "categories": ["가전", "컴퓨터", "모바일", "게임"]}'),
('SITE_C', '재고 관리 시스템', 'stock-manage-key-2025',
 '{"update_interval": 180000, "categories": ["식품", "의류", "도서", "스포츠"]}')
ON CONFLICT (site_id) DO UPDATE SET
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP;

-- 6. 트리거 통계 함수
CREATE OR REPLACE FUNCTION get_trigger_stats(
    p_site_id VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    site_id VARCHAR,
    total_triggers BIGINT,
    total_added BIGINT,
    total_updated BIGINT,
    total_deleted BIGINT,
    avg_batch_size NUMERIC,
    last_trigger TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.site_id,
        COUNT(*) as total_triggers,
        SUM(CASE WHEN t.action = 'ADD' THEN t.affected_count ELSE 0 END) as total_added,
        SUM(CASE WHEN t.action = 'UPDATE' THEN t.affected_count ELSE 0 END) as total_updated,
        SUM(CASE WHEN t.action = 'DELETE' THEN t.affected_count ELSE 0 END) as total_deleted,
        ROUND(AVG(t.affected_count), 2) as avg_batch_size,
        MAX(t.created_at) as last_trigger
    FROM v1_hub_external_triggers t
    WHERE t.created_at > CURRENT_TIMESTAMP - (p_days || ' days')::INTERVAL
        AND (p_site_id IS NULL OR t.site_id = p_site_id)
    GROUP BY t.site_id
    ORDER BY t.site_id;
END;
$$ LANGUAGE plpgsql;

-- 7. 트리거 정리 함수 (30일 이상 된 로그 삭제)
CREATE OR REPLACE FUNCTION cleanup_old_triggers()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM v1_hub_external_triggers
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 권한 설정
GRANT SELECT, INSERT, UPDATE ON v1_hub_external_triggers TO techb_pp;
GRANT SELECT ON v1_hub_site_keyword_stats TO techb_pp;
GRANT SELECT ON v1_hub_trigger_activity TO techb_pp;
GRANT SELECT, INSERT, UPDATE ON v1_hub_external_sites TO techb_pp;

-- 코멘트 추가
COMMENT ON TABLE v1_hub_external_triggers IS '외부 사이트 키워드 트리거 로그';
COMMENT ON TABLE v1_hub_external_sites IS '외부 연동 사이트 정보';
COMMENT ON VIEW v1_hub_site_keyword_stats IS '사이트별 키워드 통계';
COMMENT ON VIEW v1_hub_trigger_activity IS '트리거 활동 모니터링';
COMMENT ON FUNCTION get_trigger_stats IS '트리거 통계 조회';
COMMENT ON FUNCTION cleanup_old_triggers IS '오래된 트리거 로그 정리';