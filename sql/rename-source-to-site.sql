-- source 컬럼을 site로 변경 및 코멘트 추가
-- 실행일: 2025-08-09

-- ============================================================================
-- 1. v1_hub_work_slots 테이블 수정
-- ============================================================================

-- source 컬럼을 site로 이름 변경
ALTER TABLE v1_hub_work_slots 
RENAME COLUMN source TO site;

-- 테이블 및 컬럼 코멘트 추가/수정
COMMENT ON TABLE v1_hub_work_slots IS '작업 슬롯 정의 테이블 - 외부 사이트에서 요청한 키워드 작업 관리';

-- 기존 컬럼 코멘트
COMMENT ON COLUMN v1_hub_work_slots.id IS '작업 슬롯 고유 ID';
COMMENT ON COLUMN v1_hub_work_slots.keyword IS '검색 키워드';
COMMENT ON COLUMN v1_hub_work_slots.code IS '키워드 고유 코드 (중복 방지용)';
COMMENT ON COLUMN v1_hub_work_slots.start_date IS '작업 시작일';
COMMENT ON COLUMN v1_hub_work_slots.end_date IS '작업 종료일';
COMMENT ON COLUMN v1_hub_work_slots.daily_work_count IS '일별 목표 작업 수';
COMMENT ON COLUMN v1_hub_work_slots.cart_click_enabled IS '장바구니 클릭 활성화 여부';
COMMENT ON COLUMN v1_hub_work_slots.block_mercury IS 'Mercury CDN 차단 여부 (deprecated - extra_config 사용)';
COMMENT ON COLUMN v1_hub_work_slots.block_image_cdn IS 'Image CDN 차단 여부 (deprecated - extra_config 사용)';
COMMENT ON COLUMN v1_hub_work_slots.block_img1a_cdn IS 'IMG1A CDN 차단 여부 (deprecated - extra_config 사용)';
COMMENT ON COLUMN v1_hub_work_slots.block_thumbnail_cdn IS 'Thumbnail CDN 차단 여부 (deprecated - extra_config 사용)';
COMMENT ON COLUMN v1_hub_work_slots.extra_config IS '추가 설정 및 메타데이터 (JSONB 형식)';
COMMENT ON COLUMN v1_hub_work_slots.is_active IS '활성화 상태 (deprecated - status 사용)';
COMMENT ON COLUMN v1_hub_work_slots.created_at IS '생성 시각';
COMMENT ON COLUMN v1_hub_work_slots.updated_at IS '최종 수정 시각';

-- 새로 추가된 컬럼 코멘트
COMMENT ON COLUMN v1_hub_work_slots.site IS '키워드를 생성한 외부 사이트 ID (SITE_A: 트렌드, SITE_B: 가격비교, SITE_C: 재고관리)';
COMMENT ON COLUMN v1_hub_work_slots.status IS '키워드 상태 (active: 활성, deleted: 삭제됨)';
COMMENT ON COLUMN v1_hub_work_slots.deleted_at IS '삭제 시각';
COMMENT ON COLUMN v1_hub_work_slots.deleted_by IS '삭제한 사이트 또는 사용자 ID';

-- 인덱스 재생성 (source → site)
DROP INDEX IF EXISTS idx_work_slots_source;
CREATE INDEX idx_work_slots_site ON v1_hub_work_slots(site, status);

-- ============================================================================
-- 2. v1_hub_external_triggers 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_external_triggers IS '외부 사이트 키워드 트리거 로그 - 사이트별 ADD/UPDATE/DELETE 작업 기록';
COMMENT ON COLUMN v1_hub_external_triggers.id IS '트리거 로그 고유 ID';
COMMENT ON COLUMN v1_hub_external_triggers.site_id IS '트리거를 발생시킨 사이트 ID';
COMMENT ON COLUMN v1_hub_external_triggers.action IS '트리거 액션 (ADD: 추가, UPDATE: 수정, DELETE: 삭제)';
COMMENT ON COLUMN v1_hub_external_triggers.affected_count IS '영향받은 키워드 수';
COMMENT ON COLUMN v1_hub_external_triggers.keywords IS '영향받은 키워드 목록 (JSONB 배열)';
COMMENT ON COLUMN v1_hub_external_triggers.metadata IS '트리거 관련 추가 정보 (JSONB)';
COMMENT ON COLUMN v1_hub_external_triggers.created_at IS '트리거 발생 시각';

-- ============================================================================
-- 3. v1_hub_external_sites 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_external_sites IS '외부 연동 사이트 정보 - 웹훅 인증 및 설정 관리';
COMMENT ON COLUMN v1_hub_external_sites.site_id IS '사이트 고유 ID';
COMMENT ON COLUMN v1_hub_external_sites.site_name IS '사이트 이름';
COMMENT ON COLUMN v1_hub_external_sites.webhook_url IS '웹훅 콜백 URL';
COMMENT ON COLUMN v1_hub_external_sites.auth_key IS '웹훅 인증 키';
COMMENT ON COLUMN v1_hub_external_sites.is_active IS '사이트 활성화 상태';
COMMENT ON COLUMN v1_hub_external_sites.config IS '사이트별 설정 (JSONB)';
COMMENT ON COLUMN v1_hub_external_sites.last_trigger_at IS '마지막 트리거 발생 시각';
COMMENT ON COLUMN v1_hub_external_sites.created_at IS '사이트 등록 시각';
COMMENT ON COLUMN v1_hub_external_sites.updated_at IS '최종 수정 시각';

-- ============================================================================
-- 4. v1_hub_proxies 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_proxies IS '프록시 서버 관리 - 작업 수행 시 사용할 프록시 풀';
COMMENT ON COLUMN v1_hub_proxies.id IS '프록시 고유 ID';
COMMENT ON COLUMN v1_hub_proxies.server_ip IS '프록시 서버 IP';
COMMENT ON COLUMN v1_hub_proxies.port IS '프록시 포트 번호';
COMMENT ON COLUMN v1_hub_proxies.username IS '프록시 인증 사용자명';
COMMENT ON COLUMN v1_hub_proxies.password IS '프록시 인증 비밀번호';
COMMENT ON COLUMN v1_hub_proxies.status IS '프록시 상태 (active: 활성, inactive: 비활성, maintenance: 점검중)';
COMMENT ON COLUMN v1_hub_proxies.external_ip IS '프록시의 현재 외부 IP';
COMMENT ON COLUMN v1_hub_proxies.last_toggle_at IS '마지막 IP 토글 시각';
COMMENT ON COLUMN v1_hub_proxies.use_count IS '현재 사용 횟수 (20회 도달 시 토글 필요)';
COMMENT ON COLUMN v1_hub_proxies.is_virtual IS '가상 프록시 여부 (테스트용)';
COMMENT ON COLUMN v1_hub_proxies.created_at IS '프록시 등록 시각';
COMMENT ON COLUMN v1_hub_proxies.updated_at IS '최종 수정 시각';

-- ============================================================================
-- 5. v1_hub_work_allocations 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_work_allocations IS '작업 할당 기록 - 클라이언트별 키워드+프록시 할당 관리';
COMMENT ON COLUMN v1_hub_work_allocations.id IS '할당 고유 ID';
COMMENT ON COLUMN v1_hub_work_allocations.allocation_key IS '중복 방지용 할당 키 (날짜-키워드ID-인스턴스-폴더)';
COMMENT ON COLUMN v1_hub_work_allocations.work_slot_id IS '할당된 작업 슬롯 ID';
COMMENT ON COLUMN v1_hub_work_allocations.work_date IS '작업 날짜';
COMMENT ON COLUMN v1_hub_work_allocations.proxy_id IS '할당된 프록시 ID';
COMMENT ON COLUMN v1_hub_work_allocations.client_ip IS '클라이언트 IP 주소';
COMMENT ON COLUMN v1_hub_work_allocations.reported_instance IS '클라이언트가 보고한 인스턴스 번호';
COMMENT ON COLUMN v1_hub_work_allocations.reported_user_folder IS '클라이언트가 보고한 유저 폴더 번호';
COMMENT ON COLUMN v1_hub_work_allocations.status IS '할당 상태 (allocated: 할당됨, completed: 완료, expired: 만료, failed: 실패)';
COMMENT ON COLUMN v1_hub_work_allocations.allocated_at IS '할당 시각';
COMMENT ON COLUMN v1_hub_work_allocations.completed_at IS '완료 시각';
COMMENT ON COLUMN v1_hub_work_allocations.expires_at IS '할당 만료 시각 (120초 타임아웃)';
COMMENT ON COLUMN v1_hub_work_allocations.execution_time_ms IS '작업 실행 시간 (밀리초)';
COMMENT ON COLUMN v1_hub_work_allocations.work_config IS '작업 설정 스냅샷 (JSONB)';
COMMENT ON COLUMN v1_hub_work_allocations.result_data IS '작업 결과 데이터 (JSONB)';
COMMENT ON COLUMN v1_hub_work_allocations.created_at IS '레코드 생성 시각';

-- ============================================================================
-- 6. v1_hub_daily_work_tracking 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_daily_work_tracking IS '일별 작업 추적 - 키워드별 일일 진행 상황 모니터링';
COMMENT ON COLUMN v1_hub_daily_work_tracking.id IS '추적 레코드 고유 ID';
COMMENT ON COLUMN v1_hub_daily_work_tracking.work_slot_id IS '작업 슬롯 ID';
COMMENT ON COLUMN v1_hub_daily_work_tracking.work_date IS '작업 날짜';
COMMENT ON COLUMN v1_hub_daily_work_tracking.target_count IS '목표 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.allocated_count IS '할당된 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.completed_count IS '완료된 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.failed_count IS '실패한 작업 수';
COMMENT ON COLUMN v1_hub_daily_work_tracking.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN v1_hub_daily_work_tracking.updated_at IS '최종 업데이트 시각';

-- ============================================================================
-- 7. v1_hub_client_activity_logs 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_client_activity_logs IS '클라이언트 활동 로그 - 클라이언트별 작업 수행 기록';
COMMENT ON COLUMN v1_hub_client_activity_logs.id IS '로그 고유 ID';
COMMENT ON COLUMN v1_hub_client_activity_logs.client_ip IS '클라이언트 IP';
COMMENT ON COLUMN v1_hub_client_activity_logs.instance_number IS '인스턴스 번호';
COMMENT ON COLUMN v1_hub_client_activity_logs.user_folder_number IS '유저 폴더 번호';
COMMENT ON COLUMN v1_hub_client_activity_logs.allocation_id IS '할당 ID';
COMMENT ON COLUMN v1_hub_client_activity_logs.work_slot_id IS '작업 슬롯 ID';
COMMENT ON COLUMN v1_hub_client_activity_logs.status IS '작업 상태 (completed, failed, timeout)';
COMMENT ON COLUMN v1_hub_client_activity_logs.execution_time_ms IS '실행 시간 (밀리초)';
COMMENT ON COLUMN v1_hub_client_activity_logs.error_message IS '오류 메시지';
COMMENT ON COLUMN v1_hub_client_activity_logs.reported_at IS '보고 시각';
COMMENT ON COLUMN v1_hub_client_activity_logs.created_at IS '로그 생성 시각';

-- ============================================================================
-- 8. 아카이브 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_work_allocations_archive IS '작업 할당 아카이브 - 90일 이상 경과한 할당 기록';
COMMENT ON TABLE v1_hub_client_activity_logs_archive IS '클라이언트 활동 로그 아카이브 - 90일 이상 경과한 로그';
COMMENT ON TABLE v1_hub_proxy_toggle_logs_archive IS '프록시 토글 로그 아카이브 - 90일 이상 경과한 토글 기록';

-- ============================================================================
-- 9. 통계 및 관리 테이블 코멘트
-- ============================================================================

COMMENT ON TABLE v1_hub_daily_stats IS '일별 통계 집계 - 빠른 대시보드 조회용 사전 집계 데이터';
COMMENT ON COLUMN v1_hub_daily_stats.stat_date IS '통계 날짜';
COMMENT ON COLUMN v1_hub_daily_stats.total_allocations IS '총 할당 수';
COMMENT ON COLUMN v1_hub_daily_stats.completed_count IS '완료 수';
COMMENT ON COLUMN v1_hub_daily_stats.expired_count IS '만료 수';
COMMENT ON COLUMN v1_hub_daily_stats.failed_count IS '실패 수';
COMMENT ON COLUMN v1_hub_daily_stats.avg_execution_time_ms IS '평균 실행 시간 (밀리초)';
COMMENT ON COLUMN v1_hub_daily_stats.unique_clients IS '고유 클라이언트 수';
COMMENT ON COLUMN v1_hub_daily_stats.unique_keywords IS '고유 키워드 수';
COMMENT ON COLUMN v1_hub_daily_stats.unique_proxies IS '고유 프록시 수';
COMMENT ON COLUMN v1_hub_daily_stats.success_rate IS '성공률 (%)';
COMMENT ON COLUMN v1_hub_daily_stats.created_at IS '통계 생성 시각';
COMMENT ON COLUMN v1_hub_daily_stats.updated_at IS '통계 업데이트 시각';

COMMENT ON TABLE v1_hub_archive_history IS '아카이빙 작업 이력 - 데이터 아카이빙 실행 기록';
COMMENT ON COLUMN v1_hub_archive_history.id IS '이력 고유 ID';
COMMENT ON COLUMN v1_hub_archive_history.table_name IS '아카이빙된 테이블명';
COMMENT ON COLUMN v1_hub_archive_history.archived_date IS '아카이빙 기준 날짜';
COMMENT ON COLUMN v1_hub_archive_history.rows_archived IS '아카이빙된 행 수';
COMMENT ON COLUMN v1_hub_archive_history.rows_deleted IS '삭제된 행 수';
COMMENT ON COLUMN v1_hub_archive_history.archive_started_at IS '아카이빙 시작 시각';
COMMENT ON COLUMN v1_hub_archive_history.archive_completed_at IS '아카이빙 완료 시각';
COMMENT ON COLUMN v1_hub_archive_history.status IS '아카이빙 상태 (success, failed, partial)';
COMMENT ON COLUMN v1_hub_archive_history.error_message IS '오류 메시지';
COMMENT ON COLUMN v1_hub_archive_history.created_at IS '레코드 생성 시각';

-- ============================================================================
-- 10. 뷰 재생성 (source → site)
-- ============================================================================

DROP VIEW IF EXISTS v1_hub_site_keyword_stats;

CREATE OR REPLACE VIEW v1_hub_site_keyword_stats AS
SELECT 
    site,
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
WHERE site IS NOT NULL
GROUP BY site;

COMMENT ON VIEW v1_hub_site_keyword_stats IS '사이트별 키워드 통계 - 실시간 집계';

-- ============================================================================
-- 완료 메시지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ source → site 컬럼명 변경 완료';
    RAISE NOTICE '✅ 모든 테이블에 코멘트 추가 완료';
    RAISE NOTICE '✅ 뷰 재생성 완료';
END $$;