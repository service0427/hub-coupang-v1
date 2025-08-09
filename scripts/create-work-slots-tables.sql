-- Work Slot System Database Schema
-- Version: 1.0.0
-- Date: 2024-01-08
-- Description: 작업 슬롯 기반 중앙 집중식 작업 관리 시스템

-- ============================================================================
-- 1. v1_hub_work_slots: 작업 슬롯 정의
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_work_slots (
    id SERIAL PRIMARY KEY,
    
    -- 기본 정보
    keyword VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    
    -- 서비스 기간
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    daily_work_count INT DEFAULT 100,
    
    -- 실행 설정
    cart_click_enabled BOOLEAN DEFAULT false,
    
    -- CDN 블록 설정
    block_mercury BOOLEAN DEFAULT false,
    block_image_cdn BOOLEAN DEFAULT false,
    block_img1a_cdn BOOLEAN DEFAULT false,
    block_thumbnail_cdn BOOLEAN DEFAULT false,
    
    -- 추가 설정 (확장용)
    extra_config JSONB,
    
    -- 상태 관리
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_work_slots_date_range ON v1_hub_work_slots(start_date, end_date);
CREATE INDEX idx_work_slots_keyword ON v1_hub_work_slots(keyword);
CREATE INDEX idx_work_slots_active ON v1_hub_work_slots(is_active) WHERE is_active = true;

-- 코멘트
COMMENT ON TABLE v1_hub_work_slots IS '외부 사이트에서 접수된 작업 슬롯';
COMMENT ON COLUMN v1_hub_work_slots.keyword IS '검색 키워드';
COMMENT ON COLUMN v1_hub_work_slots.code IS '상품 코드';
COMMENT ON COLUMN v1_hub_work_slots.daily_work_count IS '일별 목표 작업 수';
COMMENT ON COLUMN v1_hub_work_slots.cart_click_enabled IS '장바구니 클릭 활성화 여부';

-- ============================================================================
-- 2. v1_hub_daily_work_tracking: 일별 작업 추적
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_daily_work_tracking (
    id SERIAL PRIMARY KEY,
    work_slot_id INT NOT NULL REFERENCES v1_hub_work_slots(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    
    -- 일별 카운트
    target_count INT NOT NULL,
    allocated_count INT DEFAULT 0,
    completed_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    
    -- 통계
    avg_response_time_ms INT,
    first_allocation_at TIMESTAMP,
    last_allocation_at TIMESTAMP,
    
    -- 제약조건
    CONSTRAINT uk_daily_tracking UNIQUE(work_slot_id, work_date)
);

-- 인덱스
CREATE INDEX idx_daily_tracking_date ON v1_hub_daily_work_tracking(work_date);
CREATE INDEX idx_daily_tracking_slot ON v1_hub_daily_work_tracking(work_slot_id, work_date);

-- 코멘트
COMMENT ON TABLE v1_hub_daily_work_tracking IS '일별 작업 진행 상황 추적';
COMMENT ON COLUMN v1_hub_daily_work_tracking.target_count IS '일별 목표 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.allocated_count IS '할당된 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.completed_count IS '완료된 작업 수';

-- ============================================================================
-- 3. v1_hub_clients: 클라이언트 관리 (자동 발견)
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_clients (
    id SERIAL PRIMARY KEY,
    client_ip VARCHAR(45) UNIQUE NOT NULL,
    client_name VARCHAR(100),
    
    -- 자동 발견 정보
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 관찰된 구성
    observed_max_instance INT DEFAULT 1,
    observed_max_user_folder INT DEFAULT 1,
    
    -- 추정 설정
    estimated_instances INT DEFAULT 8,
    estimated_users_per_instance INT DEFAULT 30,
    
    -- 상태
    is_active BOOLEAN DEFAULT true,
    total_requests INT DEFAULT 0
);

-- 인덱스
CREATE INDEX idx_clients_ip ON v1_hub_clients(client_ip);
CREATE INDEX idx_clients_active ON v1_hub_clients(is_active, last_seen_at);

-- 코멘트
COMMENT ON TABLE v1_hub_clients IS '작업 수행 클라이언트 (자동 발견)';
COMMENT ON COLUMN v1_hub_clients.client_ip IS '클라이언트 IP 주소';
COMMENT ON COLUMN v1_hub_clients.observed_max_instance IS '관찰된 최대 인스턴스 번호';
COMMENT ON COLUMN v1_hub_clients.observed_max_user_folder IS '관찰된 최대 유저 폴더 번호';

-- ============================================================================
-- 4. v1_hub_work_allocations: 작업 할당
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_work_allocations (
    id SERIAL PRIMARY KEY,
    
    -- 작업 정보
    work_slot_id INT NOT NULL REFERENCES v1_hub_work_slots(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    
    -- 프록시 할당
    proxy_id INT REFERENCES v1_hub_proxies(id),
    assigned_proxy_ip VARCHAR(45),
    assigned_proxy_port INT,
    
    -- 클라이언트 정보
    client_ip VARCHAR(45),
    reported_instance INT,
    reported_user_folder INT,
    
    -- 할당 관리
    allocation_key VARCHAR(100) UNIQUE,
    allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- 상태
    status VARCHAR(20) DEFAULT 'allocated'
    CHECK (status IN ('allocated', 'in_progress', 'completed', 'failed', 'expired'))
);

-- 인덱스
CREATE INDEX idx_allocations_client ON v1_hub_work_allocations(client_ip, allocated_at);
CREATE INDEX idx_allocations_status ON v1_hub_work_allocations(work_slot_id, work_date, status);
CREATE INDEX idx_allocations_key ON v1_hub_work_allocations(allocation_key);
CREATE INDEX idx_allocations_expires ON v1_hub_work_allocations(expires_at) WHERE status = 'allocated';

-- 코멘트
COMMENT ON TABLE v1_hub_work_allocations IS '프록시+키워드 작업 할당';
COMMENT ON COLUMN v1_hub_work_allocations.allocation_key IS '중복 방지용 고유 할당 키';
COMMENT ON COLUMN v1_hub_work_allocations.expires_at IS '할당 만료 시간';

-- ============================================================================
-- 5. v1_hub_work_results: 작업 결과
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_work_results (
    id SERIAL PRIMARY KEY,
    allocation_id INT NOT NULL REFERENCES v1_hub_work_allocations(id) ON DELETE CASCADE,
    
    -- 실행 정보
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    execution_time_ms INT,
    
    -- 클라이언트 정보
    client_ip VARCHAR(45),
    instance_number INT,
    user_folder_number INT,
    
    -- 실행 시점 설정값 (통계 추적용)
    applied_cart_click BOOLEAN,
    applied_block_mercury BOOLEAN,
    applied_block_image_cdn BOOLEAN,
    applied_block_img1a_cdn BOOLEAN,
    applied_block_thumbnail_cdn BOOLEAN,
    
    -- 결과 상태
    status VARCHAR(20) NOT NULL
    CHECK (status IN ('success', 'failed', 'blocked', 'timeout', 'error')),
    status_code INT,
    current_page INT,
    
    -- 블록 정보
    is_blocked BOOLEAN DEFAULT false,
    block_type VARCHAR(50),
    block_details JSONB,
    
    -- 성능 메트릭
    page_load_time_ms INT,
    dom_ready_time_ms INT,
    first_product_time_ms INT,
    total_requests INT,
    blocked_requests INT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_results_allocation ON v1_hub_work_results(allocation_id);
CREATE INDEX idx_results_status ON v1_hub_work_results(status, created_at);
CREATE INDEX idx_results_settings ON v1_hub_work_results(applied_cart_click, applied_block_mercury);
CREATE INDEX idx_results_blocked ON v1_hub_work_results(is_blocked) WHERE is_blocked = true;

-- 코멘트
COMMENT ON TABLE v1_hub_work_results IS '작업 실행 결과';
COMMENT ON COLUMN v1_hub_work_results.applied_cart_click IS '실행 시 cart_click 설정값';
COMMENT ON COLUMN v1_hub_work_results.block_type IS '블록 유형 (captcha, rate_limit, ip_block, tls_block)';

-- ============================================================================
-- 6. v1_hub_product_results: 상품 결과
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_product_results (
    id SERIAL PRIMARY KEY,
    result_id INT NOT NULL REFERENCES v1_hub_work_results(id) ON DELETE CASCADE,
    
    -- 상품 정보
    product_id BIGINT NOT NULL,
    product_name TEXT NOT NULL,
    rating DECIMAL(3,2),
    review_count INT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_product_results_result ON v1_hub_product_results(result_id);
CREATE INDEX idx_product_results_product ON v1_hub_product_results(product_id);

-- 코멘트
COMMENT ON TABLE v1_hub_product_results IS '검색된 상품 정보';

-- ============================================================================
-- 7. v1_hub_client_activity_logs: 클라이언트 활동 로그
-- ============================================================================
CREATE TABLE IF NOT EXISTS v1_hub_client_activity_logs (
    id SERIAL PRIMARY KEY,
    client_ip VARCHAR(45) NOT NULL,
    
    -- 보고된 정보
    instance_number INT,
    user_folder_number INT,
    
    -- 작업 정보
    allocation_id INT REFERENCES v1_hub_work_allocations(id) ON DELETE SET NULL,
    work_slot_id INT REFERENCES v1_hub_work_slots(id) ON DELETE SET NULL,
    
    -- 결과
    status VARCHAR(20),
    execution_time_ms INT,
    
    reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_activity_client ON v1_hub_client_activity_logs(client_ip, reported_at);
CREATE INDEX idx_activity_instance ON v1_hub_client_activity_logs(client_ip, instance_number, user_folder_number);

-- 코멘트
COMMENT ON TABLE v1_hub_client_activity_logs IS '클라이언트별 활동 추적';

-- ============================================================================
-- 8. 트리거 함수: updated_at 자동 업데이트
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- work_slots 테이블에 트리거 적용
CREATE TRIGGER update_work_slots_updated_at
BEFORE UPDATE ON v1_hub_work_slots
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 9. 뷰: 대시보드용
-- ============================================================================
CREATE OR REPLACE VIEW v1_hub_work_dashboard AS
SELECT 
    ws.id,
    ws.keyword,
    ws.code,
    ws.start_date,
    ws.end_date,
    ws.daily_work_count,
    ws.is_active,
    
    -- 오늘 진행률
    dwt.work_date,
    dwt.target_count,
    dwt.completed_count,
    dwt.failed_count,
    CASE 
        WHEN dwt.target_count > 0 
        THEN ROUND(dwt.completed_count::numeric / dwt.target_count * 100, 2)
        ELSE 0 
    END as completion_rate,
    
    -- 상태
    CASE 
        WHEN CURRENT_DATE < ws.start_date THEN 'pending'
        WHEN CURRENT_DATE > ws.end_date THEN 'expired'
        WHEN NOT ws.is_active THEN 'paused'
        ELSE 'active'
    END as status
    
FROM v1_hub_work_slots ws
LEFT JOIN v1_hub_daily_work_tracking dwt 
    ON ws.id = dwt.work_slot_id 
    AND dwt.work_date = CURRENT_DATE;

-- ============================================================================
-- 10. 초기 데이터 함수
-- ============================================================================
CREATE OR REPLACE FUNCTION init_daily_work_tracking()
RETURNS void AS $$
BEGIN
    -- 오늘 작업할 슬롯들의 일별 추적 레코드 생성
    INSERT INTO v1_hub_daily_work_tracking (work_slot_id, work_date, target_count)
    SELECT id, CURRENT_DATE, daily_work_count
    FROM v1_hub_work_slots
    WHERE CURRENT_DATE BETWEEN start_date AND end_date
      AND is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM v1_hub_daily_work_tracking 
        WHERE work_slot_id = v1_hub_work_slots.id 
          AND work_date = CURRENT_DATE
      );
END;
$$ LANGUAGE plpgsql;

-- 코멘트
COMMENT ON FUNCTION init_daily_work_tracking() IS '일별 작업 추적 레코드 초기화 (매일 자정 실행)';

-- ============================================================================
-- 권한 설정 (필요 시 조정)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;