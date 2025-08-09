# 쿠팡 허브 시스템 테이블 분석 문서

## 1. 테이블 버전별 비교

### 1.1 old_v1_keywords (구 시스템)
**특징**: 모놀리식 구조, 에이전트 중심 설계

#### 테이블 구조
- **기본 정보**
  - `id`: 기본키
  - `date`: 일별 관리 (CURRENT_DATE)
  - `keyword`: 검색 키워드
  - `code`: 상품 코드
  - `agent`: 실행 주체 (default, u24, vm-win11 등 9개 타입)
  - `proxy`: 프록시 URL 직접 저장 (예: socks5://112.161.54.7:10016)

- **실행 옵션 플래그** (7개)
  - `cart`: 장바구니 클릭 (기본값: true)
  - `userdata`: 사용자 데이터 사용 (기본값: true)
  - `session`: 세션 유지 (기본값: false)
  - `cache`: 캐시 사용 (기본값: true)
  - `gpu`: GPU 가속 (기본값: false)
  - `optimize`: 최적화 (기본값: true)
  - `search`: 검색 모드 (기본값: false)

- **실행 통계**
  - `max_runs`: 최대 실행 횟수 (기본값: 100)
  - `runs`: 총 실행 횟수
  - `succ`: 성공 횟수
  - `fail`: 실패 횟수
  - `log_runs`, `log_succ`, `log_fail`: 로그 관련 카운트
  - `last_run`: 마지막 실행 시간

#### 통계 (95개 레코드 분석)
- 고유 키워드: 51개
- 에이전트 타입: 9개
- 프록시 타입: 5개
- 인기 키워드 TOP 3:
  1. 비룸퓨어 충전기 v9: 20개 레코드
  2. 버뮤다 타워형 냉풍기: 5개 레코드
  3. 먼지안나는 무표백 화장지: 5개 레코드

---

### 1.2 v2_test_keywords (중간 버전)
**특징**: 블록 감지 및 모드 전환 기능 추가

#### 테이블 구조
- **기본 정보**
  - `keyword`: 검색 키워드
  - `product_code`: 상품 코드 (필수)
  - `agent`: 실행 주체
  - `proxy_server`: 프록시 서버 URL
  - `tracking_key`: 키워드:상품코드 조합

- **실행 관리**
  - `cart_click_enabled`: 장바구니 클릭 활성화
  - `max_executions`: 최대 실행 횟수
  - `current_executions`: 현재 실행 횟수
  - `success_count`, `fail_count`, `block_count`: 결과 통계

- **블록 관리 (신규)**
  - `current_mode`: 현재 모드 (goto, search 등)
  - `consecutive_blocks`: 연속 블록 횟수
  - `mode_execution_count`: 모드별 실행 횟수
  - `total_blocks`: 전체 블록 횟수
  - `last_blocked_at`: 마지막 블록 시간
  - `mode_switch_reason`: 모드 전환 이유

- **CDN 블록 플래그 (신규)**
  - `block_mercury`: Mercury CDN 블록
  - `block_image_cdn`: 이미지 CDN 블록
  - `block_img1a_cdn`: IMG1A CDN 블록
  - `block_thumbnail_cdn`: 썸네일 CDN 블록

#### 통계 (46개 레코드 분석)
- 고유 키워드: 43개
- 에이전트 타입: 12개
- cart_click 활성: 18/46 (39%)
- 프록시 지정: 30/46 (65%)

---

### 1.3 v1_hub_test_keywords (현재 시스템)
**특징**: 심플한 마스터 데이터, 관계형 설계

#### 테이블 구조
- `id`: 기본키
- `keyword`: 검색 키워드
- `code`: 상품 코드
- `option`: 옵션 (latest, popular, bestseller)
- `created_at`: 생성 시간

#### 관련 테이블
1. **v1_hub_ip_keyword_restrictions**
   - IP-키워드 사용 제한 관리
   - 1분, 10분 규칙 적용
   - 우선순위(priority) 관리

2. **v1_hub_proxy_usage**
   - 프록시-키워드 사용 이력
   - 성공/실패 추적
   - 응답 시간 기록

3. **v1_hub_proxies**
   - 프록시 리소스 관리
   - use_count로 사용량 추적

4. **v1_hub_proxy_ip_mapping**
   - 프록시별 현재 IP 매핑

---

## 2. 설계 철학 비교

### 구조적 차이
| 구분 | old_v1 | v2 | v1_hub (현재) |
|------|---------|-----|--------------|
| 설계 | 모놀리식 | 하이브리드 | 정규화 |
| 중심 | 에이전트 | 키워드+블록 | 리소스 |
| 통계 | 내장 | 내장 | 분리 |
| 프록시 | 직접 저장 | 직접 저장 | 참조 |
| 실행 옵션 | 7개 플래그 | 1개 + CDN 4개 | 없음 |

### 진화 과정
1. **v1 → v2**: 블록 감지 및 대응 메커니즘 추가
2. **v2 → v1_hub**: 완전한 정규화, 관계형 설계

---

## 3. 통합 설계 제안

### 3.1 필요한 기능 통합
- **old_v1의 장점**: 다양한 실행 옵션 플래그
- **v2의 장점**: 블록 감지 및 모드 전환
- **v1_hub의 장점**: 정규화된 구조, IP 제한 관리

### 3.2 제안 테이블 구조

#### keywords_master (키워드 마스터)
```sql
- id
- keyword
- product_code
- category
- priority
- created_at
```

#### keyword_configs (키워드별 설정)
```sql
- keyword_id (FK)
- cart_enabled
- userdata_enabled
- session_enabled
- cache_enabled
- gpu_enabled
- optimize_enabled
- search_mode
- max_executions
```

#### agents (에이전트 관리)
```sql
- id
- agent_name
- agent_type
- default_proxy_pool
- max_concurrent
- priority
```

#### keyword_agent_assignments (키워드-에이전트 할당)
```sql
- keyword_id (FK)
- agent_id (FK)
- custom_config (JSON)
- max_runs
- assigned_at
```

#### execution_stats (실행 통계)
```sql
- keyword_id (FK)
- agent_id (FK)
- proxy_id (FK)
- date
- hour
- success_count
- fail_count
- block_count
- avg_response_time
```

#### block_events (블록 이벤트)
```sql
- keyword_id (FK)
- agent_id (FK)
- proxy_id (FK)
- block_type (mercury, image_cdn, etc)
- occurred_at
- resolved_at
- resolution_method
```

### 3.3 마이그레이션 전략

1. **Phase 1**: 새 테이블 생성
2. **Phase 2**: 데이터 마이그레이션 스크립트
   - old_v1_keywords → keywords_master + keyword_configs
   - v2_test_keywords → block_events 추출
3. **Phase 3**: API 확장
   - 에이전트 파라미터 추가
   - 블록 감지 로직 통합
4. **Phase 4**: 모니터링 대시보드

### 3.4 주요 고려사항

1. **중복 키워드 처리**
   - 같은 키워드, 다른 에이전트/설정 허용
   - keyword_agent_assignments로 관리

2. **프록시 할당 전략**
   - 에이전트별 프록시 풀
   - 동적 로테이션

3. **블록 대응**
   - CDN별 블록 추적
   - 자동 모드 전환

4. **성능 최적화**
   - 시간별 집계 테이블
   - 인덱스 전략

---

## 4. 현재 시스템 활용 가능 부분

### 이미 구현된 기능
- ✅ 프록시 관리 (v1_hub_proxies)
- ✅ IP-키워드 제한 (v1_hub_ip_keyword_restrictions)
- ✅ 사용 이력 추적 (v1_hub_proxy_usage)
- ✅ 프록시 토글 (20회 사용 시)

### 추가 필요 기능
- ❌ 에이전트 관리
- ❌ 실행 옵션 플래그
- ❌ 블록 감지/대응
- ❌ 통계 집계

---

## 5. 결론

현재 시스템(v1_hub)은 프록시와 키워드를 독립적으로 관리하는 정규화된 구조를 가지고 있습니다. 
기존 시스템(old_v1, v2)의 장점인 실행 옵션과 블록 관리 기능을 통합하면 더 강력한 시스템을 구축할 수 있습니다.

### 우선순위
1. **High**: 에이전트 관리 테이블 추가
2. **Medium**: 실행 옵션 플래그 통합
3. **Low**: 블록 감지 메커니즘