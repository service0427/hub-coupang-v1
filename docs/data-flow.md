# 데이터 플로우 및 운영 가이드

## 1. 일별 운영 플로우

### 1.1 매일 자정 (크론잡)
```sql
-- 일별 작업 추적 레코드 초기화
SELECT init_daily_work_tracking();
```

### 1.2 작업 할당 플로우
```
1. 클라이언트 → GET /api/allocate-work
2. 서버:
   - 클라이언트 IP 자동 등록/업데이트
   - 활성 work_slot 확인
   - daily_work_tracking에서 할당 가능 확인
   - 프록시 할당 (use_count < 20)
   - allocation_key 생성
   - 5분 타임아웃 설정
3. 클라이언트 ← 프록시+키워드+설정 패키지
```

### 1.3 결과 제출 플로우
```
1. 클라이언트 → POST /api/submit-result
2. 서버:
   - allocation_key 검증
   - work_results 저장
   - product_results 저장 (상품 정보)
   - daily_work_tracking 업데이트
   - client_activity_logs 기록
3. 클라이언트 ← 확인 응답
```

## 2. 테이블별 데이터 라이프사이클

### v1_hub_work_slots
- **생성**: 외부 사이트 요청 시
- **수정**: 블록 설정 조정 시
- **보관**: 영구 보관

### v1_hub_daily_work_tracking
- **생성**: 매일 자정 자동
- **업데이트**: 작업 할당/완료 시
- **아카이빙**: 30일 후

### v1_hub_clients
- **생성**: 첫 요청 시 자동
- **업데이트**: 매 요청마다
- **정리**: 30일 비활성 시

### v1_hub_work_allocations
- **생성**: 작업 할당 시
- **만료**: 5분 후
- **아카이빙**: 7일 후

### v1_hub_work_results
- **생성**: 결과 제출 시
- **파티셔닝**: 월별
- **아카이빙**: 90일 후

## 3. 주요 쿼리

### 3.1 작업 슬롯 생성
```sql
INSERT INTO v1_hub_work_slots 
(keyword, code, start_date, end_date, daily_work_count, 
 cart_click_enabled, block_mercury, block_image_cdn, 
 block_img1a_cdn, block_thumbnail_cdn)
VALUES 
('노트북', '12345', '2024-01-01', '2024-01-31', 100,
 false, false, false, false, true);
```

### 3.2 오늘의 작업 현황
```sql
SELECT * FROM v1_hub_work_dashboard
WHERE work_date = CURRENT_DATE
ORDER BY completion_rate DESC;
```

### 3.3 클라이언트별 성능
```sql
SELECT 
    c.client_ip,
    c.client_name,
    COUNT(DISTINCT al.instance_number) as active_instances,
    COUNT(*) as today_tasks,
    AVG(al.execution_time_ms) as avg_time,
    SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) as successes
FROM v1_hub_clients c
JOIN v1_hub_client_activity_logs al ON c.client_ip = al.client_ip
WHERE al.reported_at >= CURRENT_DATE
GROUP BY c.client_ip, c.client_name;
```

### 3.4 설정별 효과 분석
```sql
SELECT 
    applied_cart_click,
    applied_block_mercury,
    applied_block_image_cdn,
    applied_block_img1a_cdn,
    applied_block_thumbnail_cdn,
    COUNT(*) as total,
    AVG(execution_time_ms) as avg_time,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100 as success_rate
FROM v1_hub_work_results
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 
    applied_cart_click,
    applied_block_mercury,
    applied_block_image_cdn,
    applied_block_img1a_cdn,
    applied_block_thumbnail_cdn
HAVING COUNT(*) >= 10
ORDER BY success_rate DESC;
```

## 4. 정기 유지보수

### 일별
- `init_daily_work_tracking()` 실행
- 만료된 allocation 정리

### 주별
- 비활성 클라이언트 체크
- 성능 통계 집계

### 월별
- work_results 파티셔닝
- 오래된 로그 아카이빙

## 5. 모니터링 체크포인트

### 실시간 모니터링
- 활성 슬롯 수
- 현재 할당된 작업 수
- 클라이언트 온라인 상태
- 프록시 사용률

### 알람 조건
- 블록률 > 10%
- 성공률 < 80%
- 클라이언트 오프라인 > 10분
- 프록시 고갈 임박

## 6. 트러블슈팅

### 문제: 작업이 할당되지 않음
```sql
-- 체크 1: 활성 슬롯 확인
SELECT * FROM v1_hub_work_slots 
WHERE CURRENT_DATE BETWEEN start_date AND end_date 
  AND is_active = true;

-- 체크 2: 일별 추적 확인
SELECT * FROM v1_hub_daily_work_tracking 
WHERE work_date = CURRENT_DATE;

-- 체크 3: 프록시 상태 확인
SELECT * FROM v1_hub_proxies 
WHERE use_count < 20;
```

### 문제: 높은 블록률
```sql
-- 설정별 블록률 분석
SELECT 
    block_type,
    COUNT(*) as count,
    COUNT(DISTINCT client_ip) as affected_clients
FROM v1_hub_work_results
WHERE is_blocked = true
  AND created_at >= CURRENT_DATE - INTERVAL '1 hour'
GROUP BY block_type;
```

### 문제: 클라이언트 추적 오류
```sql
-- 클라이언트 활동 확인
SELECT 
    client_ip,
    MAX(reported_at) as last_activity,
    COUNT(DISTINCT instance_number) as instances_used,
    COUNT(DISTINCT user_folder_number) as folders_used
FROM v1_hub_client_activity_logs
WHERE client_ip = '특정IP'
  AND reported_at >= CURRENT_DATE - INTERVAL '1 hour'
GROUP BY client_ip;
```

## 7. 백업 및 복구

### 백업 전략
```bash
# 일별 백업 (크론잡)
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME \
  -t "v1_hub_*" \
  -f backup_$(date +%Y%m%d).sql
```

### 복구 절차
```bash
# 특정 날짜로 복구
psql -h $DB_HOST -U $DB_USER -d $DB_NAME \
  -f backup_20240101.sql
```

## 8. 성능 최적화 팁

1. **인덱스 관리**
   - 정기적인 VACUUM ANALYZE
   - 느린 쿼리 모니터링

2. **파티셔닝**
   - work_results: 월별
   - client_activity_logs: 주별

3. **커넥션 풀**
   - 최대 연결: 100
   - 유휴 타임아웃: 60초

4. **캐싱**
   - 대시보드 데이터: 1분
   - 통계 데이터: 5분