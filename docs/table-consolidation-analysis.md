# 테이블 통합 분석 보고서

## 현재 테이블 구조 (13개 테이블)

### 1. Core (핵심 테이블) - 유지 필요 ✅
- `v1_hub_work_slots` - 작업 정의 (키워드)
- `v1_hub_work_allocations` - 작업 할당 기록

### 2. Proxy 관련 - 통합 가능 🔄
- `v1_hub_proxies` - 프록시 정보
- `v1_hub_proxy_ip_mapping` - IP 매핑
- `v1_hub_proxy_heartbeat` - 하트비트
- `v1_hub_proxy_usage` - 사용 통계

**제안**: `v1_hub_proxies`에 통합
- ip_mapping을 JSONB 컬럼으로
- heartbeat을 last_heartbeat_at 컬럼으로
- usage를 extra_stats JSONB로

### 3. Client 관련 - 통합 가능 🔄
- `v1_hub_clients` - 클라이언트 정보
- `v1_hub_client_activity_logs` - 활동 로그

**제안**: 로그는 별도 유지, 클라이언트 정보는 간소화

### 4. External 관련 - 유지 필요 ✅
- `v1_hub_external_sites` - 외부 사이트 정보
- `v1_hub_external_triggers` - 트리거 로그

### 5. Tracking/History - 통합 가능 🔄
- `v1_hub_daily_work_tracking` - 일별 추적
- `v1_hub_work_slots_history` - 변경 이력

**제안**: 이력 관리를 단일 audit 테이블로

### 6. Results - 검토 필요 ⚠️
- `v1_hub_work_results` - 작업 결과

**문제**: 22개 컬럼으로 너무 복잡
**제안**: JSONB로 간소화

## 통합 계획

### Phase 1: 프록시 테이블 통합
```sql
-- 기존 4개 테이블 → 1개로
ALTER TABLE v1_hub_proxies ADD COLUMN 
    ip_history JSONB DEFAULT '[]',
    last_heartbeat TIMESTAMP,
    usage_stats JSONB DEFAULT '{}';
```

### Phase 2: 이력 테이블 통합
```sql
-- 모든 변경 이력을 하나의 audit 테이블로
CREATE TABLE v1_hub_audit_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(50),
    record_id INTEGER,
    action VARCHAR(20),
    changed_by VARCHAR(100),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    old_data JSONB,
    new_data JSONB
);
```

### Phase 3: 결과 테이블 간소화
```sql
-- work_results를 간소화
ALTER TABLE v1_hub_work_results 
DROP COLUMN들...,
ADD COLUMN result_data JSONB;
```

## 예상 결과

### Before: 13개 테이블
- 복잡한 JOIN
- 중복 데이터
- 관리 어려움

### After: 8개 테이블
1. `v1_hub_work_slots` (핵심)
2. `v1_hub_work_allocations` (핵심)
3. `v1_hub_proxies` (통합됨)
4. `v1_hub_clients` 
5. `v1_hub_external_sites`
6. `v1_hub_external_triggers`
7. `v1_hub_audit_log` (통합 이력)
8. `v1_hub_activity_logs` (통합 로그)

## 장점
- 40% 테이블 감소
- JOIN 복잡도 감소
- 유지보수 용이
- 스토리지 효율화

## 단점
- 마이그레이션 필요
- 기존 코드 수정
- JSONB 쿼리 복잡도

## 권장사항

### 즉시 통합 가능 (리스크 낮음)
1. 프록시 관련 4개 → 1개
2. 이력 테이블 통합

### 신중한 검토 필요
1. work_results 구조 개선
2. client 관련 통합

### 유지 필요
1. 핵심 테이블 (work_slots, allocations)
2. 외부 연동 테이블