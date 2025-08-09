-- v1_hub_clients 테이블에서 client_name 컬럼 제거
-- client_ip로 대체되므로 더 이상 필요하지 않음
-- 실행일: 2025-08-09

-- 컬럼 제거
ALTER TABLE v1_hub_clients 
DROP COLUMN IF EXISTS client_name;

-- 결과 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '✅ client_name 컬럼이 제거되었습니다';
    RAISE NOTICE '=============================================';
    RAISE NOTICE '테이블: v1_hub_clients';
    RAISE NOTICE '제거된 컬럼: client_name';
    RAISE NOTICE '사용 컬럼: client_ip (식별자로 사용)';
    RAISE NOTICE '=============================================';
END $$;