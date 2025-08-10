-- v1_hub_clients 테이블에 자동 폴더 할당을 위한 컬럼 추가
-- 실행일: 2025-08-10

-- 1. 인스턴스별 마지막 할당 폴더 추적
ALTER TABLE v1_hub_clients 
ADD COLUMN IF NOT EXISTS last_assigned_folders JSONB DEFAULT '{}';

-- 2. 최대 폴더 수 (기본값 30)
ALTER TABLE v1_hub_clients 
ADD COLUMN IF NOT EXISTS max_folders INTEGER DEFAULT 30;

-- 3. 컬럼 설명 추가
COMMENT ON COLUMN v1_hub_clients.last_assigned_folders IS '인스턴스별 마지막 할당 폴더 번호 (JSON)';
COMMENT ON COLUMN v1_hub_clients.max_folders IS '최대 폴더 수 (기본 30)';

-- 결과 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ 폴더 자동 할당 컬럼이 추가되었습니다';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '테이블: v1_hub_clients';
    RAISE NOTICE '추가 컬럼:';
    RAISE NOTICE '  - last_assigned_folders: 인스턴스별 마지막 폴더';
    RAISE NOTICE '  - max_folders: 최대 폴더 수 (기본 30)';
    RAISE NOTICE '=============================================';
END $$;