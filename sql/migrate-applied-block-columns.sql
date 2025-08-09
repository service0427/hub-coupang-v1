-- applied_block_* 컬럼들 마이그레이션 및 관련 수정
-- 실행일: 2025-08-09

-- ============================================================================
-- 1. v1_hub_work_results 테이블 확인 및 마이그레이션
-- ============================================================================

-- 테이블이 존재하는지 확인
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_name = 'v1_hub_work_results') THEN
        
        -- applied_settings JSONB 컬럼 추가 (없으면)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'v1_hub_work_results' 
                      AND column_name = 'applied_settings') THEN
            ALTER TABLE v1_hub_work_results 
            ADD COLUMN applied_settings JSONB DEFAULT '{}';
        END IF;
        
        -- 기존 applied_block_* 데이터를 JSONB로 마이그레이션
        UPDATE v1_hub_work_results
        SET applied_settings = jsonb_build_object(
            'cart_click_enabled', COALESCE(applied_cart_click, false),
            'block_settings', jsonb_build_object(
                'block_mercury', COALESCE(applied_block_mercury, false),
                'block_image_cdn', COALESCE(applied_block_image_cdn, false),
                'block_img1a_cdn', COALESCE(applied_block_img1a_cdn, false),
                'block_thumbnail_cdn', COALESCE(applied_block_thumbnail_cdn, false)
            )
        )
        WHERE applied_block_mercury IS NOT NULL 
           OR applied_block_image_cdn IS NOT NULL 
           OR applied_block_img1a_cdn IS NOT NULL 
           OR applied_block_thumbnail_cdn IS NOT NULL;
        
        -- 기존 컬럼 삭제
        ALTER TABLE v1_hub_work_results
        DROP COLUMN IF EXISTS applied_block_mercury,
        DROP COLUMN IF EXISTS applied_block_image_cdn,
        DROP COLUMN IF EXISTS applied_block_img1a_cdn,
        DROP COLUMN IF EXISTS applied_block_thumbnail_cdn;
        
        RAISE NOTICE '✅ v1_hub_work_results 테이블 마이그레이션 완료';
    ELSE
        RAISE NOTICE 'ℹ️ v1_hub_work_results 테이블이 존재하지 않음';
    END IF;
END $$;

-- ============================================================================
-- 2. 인덱스 재생성
-- ============================================================================

-- 기존 인덱스 삭제
DROP INDEX IF EXISTS idx_results_settings;

-- 새로운 JSONB 기반 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_results_applied_settings 
ON v1_hub_work_results USING gin (applied_settings)
WHERE applied_settings IS NOT NULL;

-- cart_click이 활성화된 결과 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_results_cart_click_true
ON v1_hub_work_results ((applied_settings->>'cart_click_enabled'))
WHERE (applied_settings->>'cart_click_enabled')::boolean = true;

-- ============================================================================
-- 3. 헬퍼 함수 생성
-- ============================================================================

-- 작업 결과의 applied 설정 조회
CREATE OR REPLACE FUNCTION get_applied_settings(result_id INTEGER)
RETURNS jsonb AS $$
DECLARE
    settings jsonb;
BEGIN
    SELECT 
        COALESCE(applied_settings, 
                jsonb_build_object(
                    'cart_click_enabled', false,
                    'block_settings', jsonb_build_object(
                        'block_mercury', false,
                        'block_image_cdn', false,
                        'block_img1a_cdn', false,
                        'block_thumbnail_cdn', false
                    )
                ))
    INTO settings
    FROM v1_hub_work_results
    WHERE id = result_id;
    
    RETURN settings;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. 호환성 뷰 생성
-- ============================================================================

CREATE OR REPLACE VIEW v1_hub_work_results_compat AS
SELECT 
    id,
    allocation_id,
    status,
    search_started_at,
    search_completed_at,
    search_duration_ms,
    -- 가상 컬럼으로 applied_block_* 제공
    (applied_settings->>'cart_click_enabled')::boolean as applied_cart_click,
    (applied_settings->'block_settings'->>'block_mercury')::boolean as applied_block_mercury,
    (applied_settings->'block_settings'->>'block_image_cdn')::boolean as applied_block_image_cdn,
    (applied_settings->'block_settings'->>'block_img1a_cdn')::boolean as applied_block_img1a_cdn,
    (applied_settings->'block_settings'->>'block_thumbnail_cdn')::boolean as applied_block_thumbnail_cdn,
    applied_settings,
    product_count,
    is_blocked,
    block_type,
    error_message,
    retry_count,
    user_agent,
    result_summary,
    created_at
FROM v1_hub_work_results;

COMMENT ON VIEW v1_hub_work_results_compat IS '하위 호환성을 위한 뷰 - applied_block_* 컬럼을 가상으로 제공';

-- ============================================================================
-- 5. 완료 메시지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ applied_block_* 컬럼 마이그레이션 완료!';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. applied_block_* 컬럼들이 applied_settings JSONB로 통합됨';
    RAISE NOTICE '2. 호환성 뷰 v1_hub_work_results_compat 생성';
    RAISE NOTICE '3. 헬퍼 함수 get_applied_settings() 생성';
    RAISE NOTICE '';
END $$;