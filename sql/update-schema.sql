-- 1. work_slots 테이블에 extra_config 컬럼 추가
ALTER TABLE v1_hub_work_slots 
ADD COLUMN IF NOT EXISTS extra_config JSONB DEFAULT '{}';

-- 2. 기존 block 설정을 extra_config로 마이그레이션
UPDATE v1_hub_work_slots 
SET extra_config = jsonb_build_object(
    'block_mercury', block_mercury,
    'block_image_cdn', block_image_cdn,
    'block_img1a_cdn', block_img1a_cdn,
    'block_thumbnail_cdn', block_thumbnail_cdn,
    'cart_click_enabled', cart_click_enabled,
    'scenario_repeat_count', COALESCE((extra_config->>'scenario_repeat_count')::int, 1000)
)
WHERE extra_config = '{}' OR extra_config IS NULL;

-- 3. work_slots 변경 히스토리 테이블 생성
CREATE TABLE IF NOT EXISTS v1_hub_work_slots_history (
    id SERIAL PRIMARY KEY,
    work_slot_id INTEGER NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(100),
    operation VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    change_summary TEXT,
    FOREIGN KEY (work_slot_id) REFERENCES v1_hub_work_slots(id) ON DELETE CASCADE
);

-- 4. work_allocations에 스냅샷 저장을 위한 컬럼 추가
ALTER TABLE v1_hub_work_allocations 
ADD COLUMN IF NOT EXISTS work_slot_snapshot JSONB;

-- 5. 히스토리 트리거 함수 생성
CREATE OR REPLACE FUNCTION track_work_slot_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO v1_hub_work_slots_history (
            work_slot_id, operation, new_data, change_summary
        ) VALUES (
            NEW.id, 'INSERT', row_to_json(NEW), 
            'Created new work slot: ' || NEW.keyword
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 실제 변경이 있는 경우만 기록
        IF OLD IS DISTINCT FROM NEW THEN
            INSERT INTO v1_hub_work_slots_history (
                work_slot_id, operation, old_data, new_data, change_summary
            ) VALUES (
                NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW),
                CASE 
                    WHEN OLD.keyword != NEW.keyword THEN 'Keyword changed: ' || OLD.keyword || ' → ' || NEW.keyword
                    WHEN OLD.code != NEW.code THEN 'Code changed: ' || OLD.code || ' → ' || NEW.code
                    WHEN OLD.end_date != NEW.end_date THEN 'End date changed: ' || OLD.end_date || ' → ' || NEW.end_date
                    WHEN OLD.extra_config != NEW.extra_config THEN 'Config updated'
                    ELSE 'Other changes'
                END
            );
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO v1_hub_work_slots_history (
            work_slot_id, operation, old_data, change_summary
        ) VALUES (
            OLD.id, 'DELETE', row_to_json(OLD),
            'Deleted work slot: ' || OLD.keyword
        );
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. 트리거 생성
DROP TRIGGER IF EXISTS work_slot_changes_trigger ON v1_hub_work_slots;
CREATE TRIGGER work_slot_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON v1_hub_work_slots
FOR EACH ROW EXECUTE FUNCTION track_work_slot_changes();

-- 7. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_work_slots_history_slot_id ON v1_hub_work_slots_history(work_slot_id);
CREATE INDEX IF NOT EXISTS idx_work_slots_history_changed_at ON v1_hub_work_slots_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_slots_extra_config ON v1_hub_work_slots USING GIN (extra_config);

-- 8. 기존 컬럼 삭제 (데이터 마이그레이션 후)
-- 주의: 마이그레이션 확인 후 실행
-- ALTER TABLE v1_hub_work_slots 
-- DROP COLUMN block_mercury,
-- DROP COLUMN block_image_cdn,
-- DROP COLUMN block_img1a_cdn,
-- DROP COLUMN block_thumbnail_cdn,
-- DROP COLUMN cart_click_enabled;