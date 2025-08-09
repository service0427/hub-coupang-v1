-- block_* 컬럼들을 extra_config JSONB로 통합
-- 실행일: 2025-08-09

-- ============================================================================
-- 1. 기존 데이터를 extra_config로 마이그레이션
-- ============================================================================

-- extra_config가 NULL인 경우 빈 객체로 초기화
UPDATE v1_hub_work_slots 
SET extra_config = '{}'::jsonb
WHERE extra_config IS NULL;

-- block_* 컬럼 데이터를 extra_config로 이동
UPDATE v1_hub_work_slots
SET extra_config = extra_config || 
    jsonb_build_object(
        'block_settings', jsonb_build_object(
            'block_mercury', COALESCE(block_mercury, false),
            'block_image_cdn', COALESCE(block_image_cdn, false),
            'block_img1a_cdn', COALESCE(block_img1a_cdn, false),
            'block_thumbnail_cdn', COALESCE(block_thumbnail_cdn, false)
        )
    )
WHERE block_mercury IS NOT NULL 
   OR block_image_cdn IS NOT NULL 
   OR block_img1a_cdn IS NOT NULL 
   OR block_thumbnail_cdn IS NOT NULL;

-- 통계 출력
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count
    FROM v1_hub_work_slots
    WHERE extra_config ? 'block_settings';
    
    RAISE NOTICE '✅ %개 레코드의 block 설정을 extra_config로 마이그레이션 완료', updated_count;
END $$;

-- ============================================================================
-- 2. 기존 block_* 컬럼 삭제
-- ============================================================================

-- 컬럼 삭제
ALTER TABLE v1_hub_work_slots 
DROP COLUMN IF EXISTS block_mercury,
DROP COLUMN IF EXISTS block_image_cdn,
DROP COLUMN IF EXISTS block_img1a_cdn,
DROP COLUMN IF EXISTS block_thumbnail_cdn;

-- ============================================================================
-- 3. 헬퍼 함수 생성 (block 설정 읽기/쓰기)
-- ============================================================================

-- block 설정 읽기 함수
CREATE OR REPLACE FUNCTION get_block_settings(work_slot_id INTEGER)
RETURNS jsonb AS $$
DECLARE
    settings jsonb;
BEGIN
    SELECT 
        COALESCE(extra_config->'block_settings', 
                jsonb_build_object(
                    'block_mercury', false,
                    'block_image_cdn', false,
                    'block_img1a_cdn', false,
                    'block_thumbnail_cdn', false
                ))
    INTO settings
    FROM v1_hub_work_slots
    WHERE id = work_slot_id;
    
    RETURN settings;
END;
$$ LANGUAGE plpgsql;

-- block 설정 업데이트 함수
CREATE OR REPLACE FUNCTION update_block_settings(
    work_slot_id INTEGER,
    block_mercury BOOLEAN DEFAULT NULL,
    block_image_cdn BOOLEAN DEFAULT NULL,
    block_img1a_cdn BOOLEAN DEFAULT NULL,
    block_thumbnail_cdn BOOLEAN DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    UPDATE v1_hub_work_slots
    SET extra_config = extra_config || 
        jsonb_build_object(
            'block_settings', 
            COALESCE(extra_config->'block_settings', '{}'::jsonb) ||
            jsonb_strip_nulls(
                jsonb_build_object(
                    'block_mercury', block_mercury,
                    'block_image_cdn', block_image_cdn,
                    'block_img1a_cdn', block_img1a_cdn,
                    'block_thumbnail_cdn', block_thumbnail_cdn
                )
            )
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = work_slot_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. 뷰 생성 (기존 코드 호환성을 위한 가상 컬럼)
-- ============================================================================

CREATE OR REPLACE VIEW v1_hub_work_slots_compat AS
SELECT 
    id,
    keyword,
    code,
    start_date,
    end_date,
    daily_work_count,
    cart_click_enabled,
    -- block 설정을 가상 컬럼으로 제공
    (extra_config->'block_settings'->>'block_mercury')::boolean as block_mercury,
    (extra_config->'block_settings'->>'block_image_cdn')::boolean as block_image_cdn,
    (extra_config->'block_settings'->>'block_img1a_cdn')::boolean as block_img1a_cdn,
    (extra_config->'block_settings'->>'block_thumbnail_cdn')::boolean as block_thumbnail_cdn,
    extra_config,
    site,
    status,
    deleted_at,
    deleted_by,
    is_active,
    created_at,
    updated_at
FROM v1_hub_work_slots;

COMMENT ON VIEW v1_hub_work_slots_compat IS '하위 호환성을 위한 뷰 - block_* 컬럼을 가상으로 제공';

-- ============================================================================
-- 5. 인덱스 생성 (JSONB 기반)
-- ============================================================================

-- block_settings에 대한 GIN 인덱스
CREATE INDEX IF NOT EXISTS idx_work_slots_block_settings 
ON v1_hub_work_slots USING gin ((extra_config->'block_settings'));

-- 특정 block 설정이 true인 레코드를 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_work_slots_block_mercury_true
ON v1_hub_work_slots ((extra_config->'block_settings'->>'block_mercury'))
WHERE (extra_config->'block_settings'->>'block_mercury')::boolean = true;

-- ============================================================================
-- 6. 완료 메시지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ block_* 컬럼 마이그레이션 완료!';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. block_mercury, block_image_cdn, block_img1a_cdn, block_thumbnail_cdn 컬럼 삭제됨';
    RAISE NOTICE '2. 모든 block 설정은 extra_config->"block_settings"에 저장됨';
    RAISE NOTICE '3. 헬퍼 함수 생성: get_block_settings(), update_block_settings()';
    RAISE NOTICE '4. 호환성 뷰 생성: v1_hub_work_slots_compat';
    RAISE NOTICE '';
    RAISE NOTICE '사용 예시:';
    RAISE NOTICE '- 읽기: SELECT extra_config->"block_settings" FROM v1_hub_work_slots;';
    RAISE NOTICE '- 쓰기: UPDATE v1_hub_work_slots SET extra_config = extra_config || ''{"block_settings": {"block_mercury": true}}'';';
    RAISE NOTICE '- 함수: SELECT get_block_settings(1);';
END $$;