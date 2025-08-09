# 데이터베이스 설계 문서

## 1. 테이블 구조

### 1.1 v1_hub_work_slots (작업 슬롯)
**목적**: 외부 사이트에서 접수된 작업 정의

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| keyword | VARCHAR(255) | 검색 키워드 | NOT NULL |
| code | VARCHAR(100) | 상품 코드 | |
| start_date | DATE | 서비스 시작일 | NOT NULL |
| end_date | DATE | 서비스 종료일 | NOT NULL |
| daily_work_count | INT | 일별 작업 수 | DEFAULT 100 |
| cart_click_enabled | BOOLEAN | 장바구니 클릭 활성화 | DEFAULT false |
| block_mercury | BOOLEAN | Mercury CDN 차단 | DEFAULT false |
| block_image_cdn | BOOLEAN | 이미지 CDN 차단 | DEFAULT false |
| block_img1a_cdn | BOOLEAN | IMG1A CDN 차단 | DEFAULT false |
| block_thumbnail_cdn | BOOLEAN | 썸네일 CDN 차단 | DEFAULT false |
| extra_config | JSONB | 추가 설정 | |
| is_active | BOOLEAN | 활성 상태 | DEFAULT true |
| created_at | TIMESTAMP | 생성 시간 | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | 수정 시간 | DEFAULT CURRENT_TIMESTAMP |

**인덱스**:
- idx_date_range (start_date, end_date)
- idx_keyword (keyword)

### 1.2 v1_hub_daily_work_tracking (일별 작업 추적)
**목적**: 일별 작업 진행 상황 추적

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| work_slot_id | INT | 작업 슬롯 ID | REFERENCES v1_hub_work_slots(id) |
| work_date | DATE | 작업 일자 | NOT NULL |
| target_count | INT | 목표 작업 수 | NOT NULL |
| allocated_count | INT | 할당된 수 | DEFAULT 0 |
| completed_count | INT | 완료된 수 | DEFAULT 0 |
| failed_count | INT | 실패한 수 | DEFAULT 0 |
| avg_response_time_ms | INT | 평균 응답 시간 | |
| first_allocation_at | TIMESTAMP | 첫 할당 시간 | |
| last_allocation_at | TIMESTAMP | 마지막 할당 시간 | |

**제약조건**:
- UNIQUE(work_slot_id, work_date)

### 1.3 v1_hub_clients (클라이언트)
**목적**: 작업 수행 클라이언트 관리 (자동 발견)

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| client_ip | VARCHAR(45) | 클라이언트 IP | UNIQUE NOT NULL |
| client_name | VARCHAR(100) | 클라이언트 이름 | |
| first_seen_at | TIMESTAMP | 최초 발견 시간 | DEFAULT CURRENT_TIMESTAMP |
| last_seen_at | TIMESTAMP | 마지막 활동 시간 | DEFAULT CURRENT_TIMESTAMP |
| observed_max_instance | INT | 관찰된 최대 인스턴스 | DEFAULT 1 |
| observed_max_user_folder | INT | 관찰된 최대 폴더 | DEFAULT 1 |
| estimated_instances | INT | 추정 인스턴스 수 | DEFAULT 8 |
| estimated_users_per_instance | INT | 인스턴스당 폴더 수 | DEFAULT 30 |
| is_active | BOOLEAN | 활성 상태 | DEFAULT true |
| total_requests | INT | 총 요청 수 | DEFAULT 0 |

**인덱스**:
- idx_client_ip (client_ip)

### 1.4 v1_hub_work_allocations (작업 할당)
**목적**: 프록시+키워드 할당 관리

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| work_slot_id | INT | 작업 슬롯 ID | REFERENCES v1_hub_work_slots(id) |
| work_date | DATE | 작업 일자 | NOT NULL |
| proxy_id | INT | 프록시 ID | REFERENCES v1_hub_proxies(id) |
| assigned_proxy_ip | VARCHAR(45) | 할당된 프록시 IP | |
| assigned_proxy_port | INT | 할당된 프록시 포트 | |
| client_ip | VARCHAR(45) | 클라이언트 IP | |
| reported_instance | INT | 보고된 인스턴스 번호 | |
| reported_user_folder | INT | 보고된 유저 폴더 | |
| allocation_key | VARCHAR(100) | 할당 키 | UNIQUE |
| allocated_at | TIMESTAMP | 할당 시간 | DEFAULT CURRENT_TIMESTAMP |
| expires_at | TIMESTAMP | 만료 시간 | |
| completed_at | TIMESTAMP | 완료 시간 | |
| status | VARCHAR(20) | 상태 | DEFAULT 'allocated' |

**인덱스**:
- idx_client_tracking (client_ip, allocated_at)
- idx_work_status (work_slot_id, work_date, status)

### 1.5 v1_hub_work_results (작업 결과)
**목적**: 작업 실행 결과 저장

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| allocation_id | INT | 할당 ID | REFERENCES v1_hub_work_allocations(id) |
| started_at | TIMESTAMP | 시작 시간 | NOT NULL |
| completed_at | TIMESTAMP | 완료 시간 | |
| execution_time_ms | INT | 실행 시간(ms) | |
| client_ip | VARCHAR(45) | 클라이언트 IP | |
| instance_number | INT | 인스턴스 번호 | |
| user_folder_number | INT | 유저 폴더 번호 | |
| applied_cart_click | BOOLEAN | 실행 시 cart_click 설정 | |
| applied_block_mercury | BOOLEAN | 실행 시 block_mercury 설정 | |
| applied_block_image_cdn | BOOLEAN | 실행 시 block_image_cdn 설정 | |
| applied_block_img1a_cdn | BOOLEAN | 실행 시 block_img1a_cdn 설정 | |
| applied_block_thumbnail_cdn | BOOLEAN | 실행 시 block_thumbnail_cdn 설정 | |
| status | VARCHAR(20) | 결과 상태 | NOT NULL |
| status_code | INT | HTTP 상태 코드 | |
| current_page | INT | 현재 페이지 | |
| is_blocked | BOOLEAN | 블록 여부 | DEFAULT false |
| block_type | VARCHAR(50) | 블록 유형 | |
| block_details | JSONB | 블록 상세 | |
| page_load_time_ms | INT | 페이지 로드 시간 | |
| dom_ready_time_ms | INT | DOM 준비 시간 | |
| first_product_time_ms | INT | 첫 상품 로드 시간 | |
| total_requests | INT | 총 요청 수 | |
| blocked_requests | INT | 차단된 요청 수 | |
| created_at | TIMESTAMP | 생성 시간 | DEFAULT CURRENT_TIMESTAMP |

**인덱스**:
- idx_result_settings (applied_cart_click, applied_block_mercury)
- idx_result_status (allocation_id, status)

### 1.6 v1_hub_product_results (상품 결과)
**목적**: 검색된 상품 정보 저장

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| result_id | INT | 결과 ID | REFERENCES v1_hub_work_results(id) |
| product_id | BIGINT | 쿠팡 상품 ID | NOT NULL |
| product_name | TEXT | 상품명 | NOT NULL |
| rating | DECIMAL(3,2) | 평점 | |
| review_count | INT | 리뷰 수 | |

**인덱스**:
- idx_product_result (result_id)

### 1.7 v1_hub_client_activity_logs (클라이언트 활동 로그)
**목적**: 클라이언트별 활동 추적

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | SERIAL | 기본키 | PRIMARY KEY |
| client_ip | VARCHAR(45) | 클라이언트 IP | NOT NULL |
| instance_number | INT | 인스턴스 번호 | |
| user_folder_number | INT | 유저 폴더 번호 | |
| allocation_id | INT | 할당 ID | REFERENCES v1_hub_work_allocations(id) |
| work_slot_id | INT | 작업 슬롯 ID | REFERENCES v1_hub_work_slots(id) |
| status | VARCHAR(20) | 상태 | |
| execution_time_ms | INT | 실행 시간 | |
| reported_at | TIMESTAMP | 보고 시간 | DEFAULT CURRENT_TIMESTAMP |

**인덱스**:
- idx_client_activity (client_ip, reported_at)
- idx_instance_tracking (client_ip, instance_number, user_folder_number)

## 2. 관계도

```
v1_hub_work_slots
    ↓ (1:N)
v1_hub_daily_work_tracking
    
v1_hub_work_slots
    ↓ (1:N)
v1_hub_work_allocations ← v1_hub_proxies
    ↓ (1:1)
v1_hub_work_results
    ↓ (1:N)
v1_hub_product_results

v1_hub_clients (자동 발견)
    ↓
v1_hub_client_activity_logs ← v1_hub_work_allocations
```

## 3. 기존 테이블과의 연계

- **v1_hub_proxies**: 프록시 관리 (기존 활용)
- **v1_hub_proxy_ip_mapping**: IP 매핑 (기존 활용)
- **v1_hub_ip_keyword_restrictions**: IP-키워드 제한 (기존 활용)
- **v1_hub_proxy_usage**: 프록시 사용 이력 (확장 가능)

## 4. 마이그레이션 고려사항

1. **기존 데이터 보존**: old_v1_*, v2_* 테이블은 참조용으로 유지
2. **점진적 전환**: 기존 시스템과 병행 운영 가능
3. **롤백 계획**: 각 테이블별 백업 및 복구 전략

## 5. 성능 최적화

1. **인덱스 전략**
   - 자주 조회되는 컬럼에 인덱스 생성
   - 복합 인덱스로 쿼리 최적화

2. **파티셔닝 고려**
   - work_results: 월별 파티셔닝
   - client_activity_logs: 일별 파티셔닝

3. **아카이빙**
   - 30일 이상 된 로그 데이터 아카이브
   - 완료된 work_slot 데이터 별도 보관