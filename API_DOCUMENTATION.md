# 허브 서버 API 문서 v1.0

## 개요
쿠팡 작업 관리를 위한 중앙 집중식 허브 서버 API

- **Base URL**: `http://mkt.techb.kr:3001`
- **인증**: 현재 없음 (추후 추가 예정)
- **응답 형식**: JSON

## 목차
1. [작업 할당 API](#1-작업-할당-api)
2. [결과 제출 API](#2-결과-제출-api)
3. [프록시 관리 API](#3-프록시-관리-api)
4. [작업 슬롯 관리 API](#4-작업-슬롯-관리-api)
5. [모니터링 API](#5-모니터링-api)
6. [웹훅 API](#6-웹훅-api)

---

## 1. 작업 할당 API

### GET `/api/allocate-work`
작업(키워드+프록시) 할당 요청 - 서버가 자동으로 폴더 할당

**curl 예제:**
```bash
# 기본 요청 (instance=1)
curl "http://mkt.techb.kr:3001/api/allocate-work"

# 특정 인스턴스 지정
curl "http://mkt.techb.kr:3001/api/allocate-work?instance=1"
```

**Query Parameters:**
```
instance: 인스턴스 번호 (선택적, 기본값: 1)
```

**Response (200 OK):**
```json
{
    "success": true,
    "allocation_key": "WA-20250809-a1b2c3d4e5f6",
    "folder": 3,  // 서버가 자동 할당한 폴더 번호 (1~30 순환)
    "work": {
        "keyword": "무선이어폰",
        "code": "PROD123456"
    },
    "proxy": {
        "url": "socks5://112.161.54.7:10001",
        "external_ip": "203.123.45.67",
        "use_count": 5
    },
    "settings": {
        "cart_click_enabled": false,
        "block_mercury": false,
        "block_image_cdn": false,
        "block_img1a_cdn": false,
        "block_thumbnail_cdn": false
    },
    "expires_at": "2025-08-09T10:15:30Z"
}
```

**Response (503 Service Unavailable):**
```json
{
    "success": false,
    "error": "NO_WORK_AVAILABLE",
    "message": "할당 가능한 작업이 없습니다"
}
```

---

## 2. 결과 제출 API

### POST `/api/submit-result`
작업 완료 결과 제출

**curl 예제:**
```bash
curl -X POST http://mkt.techb.kr:3001/api/submit-result \
  -H "Content-Type: application/json" \
  -d '{
    "allocation_key": "WA-20250809-a1b2c3d4e5f6",
    "status": "completed",
    "execution": {
        "started_at": "2025-08-09T10:13:30Z",
        "completed_at": "2025-08-09T10:13:39Z",
        "execution_time_ms": 9000,
        "instance_number": 1,
        "user_folder": 1
    },
    "result": {
        "status": "success",
        "status_code": 200,
        "current_page": 1,
        "products_found": 60
    }
  }'
```

**Request Body:**
```json
{
    "allocation_key": "WA-20250809-a1b2c3d4e5f6",
    "status": "completed",
    "execution": {
        "started_at": "2025-08-09T10:13:30Z",
        "completed_at": "2025-08-09T10:13:39Z",
        "execution_time_ms": 9000,
        "instance_number": 1,
        "user_folder": 1
    },
    "result": {
        "status": "success",
        "status_code": 200,
        "current_page": 1,
        "products_found": 60,
        "searched_products": [
            {
                "product_id": "1234567890",
                "name": "삼성 갤럭시 버즈",
                "price": 159000,
                "position": 1
            }
        ]
    },
    "applied_settings": {
        "cart_click_enabled": false,
        "block_mercury": false,
        "block_image_cdn": false,
        "block_img1a_cdn": false,
        "block_thumbnail_cdn": false
    },
    "performance": {
        "page_load_time_ms": 1500,
        "dom_ready_time_ms": 800,
        "first_product_time_ms": 2000,
        "total_requests": 45,
        "blocked_requests": 12
    }
}
```

**Response (200 OK):**
```json
{
    "success": true,
    "message": "결과가 성공적으로 저장되었습니다",
    "result_id": 123456
}
```

---

## 3. 프록시 관리 API

### GET `/api/proxy/status`
모든 프록시 상태 조회

**curl 예제:**
```bash
curl -X GET http://mkt.techb.kr:3001/api/proxy/status
```

**Response:**
```json
{
    "success": true,
    "total": 500,
    "active": 495,
    "available": 480,
    "need_toggle": 15,
    "proxies": [
        {
            "id": 1,
            "server_ip": "112.161.54.7",
            "port": 10001,
            "status": "active",
            "use_count": 5,
            "external_ip": "203.123.45.67",
            "last_toggle_at": "2025-08-09T09:30:00Z"
        }
    ]
}
```

### POST `/api/proxy/toggle/:proxyId`
특정 프록시 IP 토글

**curl 예제:**
```bash
curl -X POST http://mkt.techb.kr:3001/api/proxy/toggle/1
```

**Response:**
```json
{
    "success": true,
    "proxy_id": 1,
    "old_ip": "203.123.45.67",
    "new_ip": "203.234.56.78",
    "processing_time_ms": 3500
}
```

### GET `/api/proxy/toggle-queue/status`
토글 큐 상태 조회

**curl 예제:**
```bash
curl -X GET http://mkt.techb.kr:3001/api/proxy/toggle-queue/status
```

**Response:**
```json
{
    "queueSize": 3,
    "processing": true,
    "globalCooldownRemaining": 25,
    "stats": {
        "totalRequests": 150,
        "successCount": 145,
        "failCount": 5,
        "cooldownWaits": 50,
        "retryCount": 8
    }
}
```

---

## 4. 작업 슬롯 관리 API

### GET `/api/work-slots`
모든 작업 슬롯 조회

**curl 예제:**
```bash
# 모든 슬롯 조회
curl -X GET http://mkt.techb.kr:3001/api/work-slots

# 특정 사이트 필터링
curl -X GET "http://mkt.techb.kr:3001/api/work-slots?site=SITE_A&status=active&limit=50"
```

**Query Parameters:**
- `site`: 사이트 필터 (SITE_A, SITE_B, SITE_C)
- `status`: 상태 필터 (active, deleted)
- `limit`: 결과 제한 (기본: 100)

**Response:**
```json
{
    "success": true,
    "total": 2000,
    "slots": [
        {
            "id": 1,
            "keyword": "무선이어폰",
            "code": "PROD123456",
            "site": "SITE_A",
            "status": "active",
            "start_date": "2025-08-01",
            "end_date": "2025-08-31",
            "daily_work_count": 100,
            "cart_click_enabled": false,
            "extra_config": {
                "block_settings": {
                    "block_mercury": false,
                    "block_image_cdn": false,
                    "block_img1a_cdn": false,
                    "block_thumbnail_cdn": false
                }
            }
        }
    ]
}
```

### POST `/api/work-slots`
새 작업 슬롯 생성

**curl 예제:**
```bash
curl -X POST http://mkt.techb.kr:3001/api/work-slots \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "새 상품 키워드",
    "code": "NEW_PROD_001",
    "site": "SITE_A",
    "start_date": "2025-08-10",
    "end_date": "2025-09-10",
    "daily_work_count": 100,
    "cart_click_enabled": false
  }'
```

**Request Body:**
```json
{
    "keyword": "새 상품 키워드",
    "code": "NEW_PROD_001",
    "site": "SITE_A",
    "start_date": "2025-08-10",
    "end_date": "2025-09-10",
    "daily_work_count": 100,
    "cart_click_enabled": false,
    "extra_config": {
        "block_settings": {
            "block_mercury": false,
            "block_image_cdn": false,
            "block_img1a_cdn": false,
            "block_thumbnail_cdn": false
        }
    }
}
```

### PUT `/api/work-slots/:id`
작업 슬롯 수정

**curl 예제:**
```bash
curl -X PUT http://mkt.techb.kr:3001/api/work-slots/1 \
  -H "Content-Type: application/json" \
  -d '{
    "daily_work_count": 150,
    "cart_click_enabled": true
  }'
```

### DELETE `/api/work-slots/:id`
작업 슬롯 삭제 (소프트 삭제)

**curl 예제:**
```bash
curl -X DELETE http://mkt.techb.kr:3001/api/work-slots/1
```

---

## 5. 모니터링 API

### GET `/api/stats/dashboard`
대시보드 통계

**curl 예제:**
```bash
curl -X GET http://mkt.techb.kr:3001/api/stats/dashboard
```

**Response:**
```json
{
    "success": true,
    "stats": {
        "today": {
            "total_allocations": 50000,
            "completed": 47500,
            "active": 500,
            "expired": 2000,
            "completion_rate": 95.0
        },
        "proxies": {
            "total": 500,
            "active": 495,
            "available": 480,
            "need_toggle": 15
        },
        "keywords": {
            "total": 2000,
            "active": 1950,
            "deleted": 50,
            "sites": {
                "SITE_A": 700,
                "SITE_B": 650,
                "SITE_C": 650
            }
        },
        "performance": {
            "avg_execution_time_ms": 8500,
            "success_rate": 95.2,
            "hourly_throughput": 2100
        }
    }
}
```

### GET `/api/stats/work-tracking`
일별 작업 추적 현황

**curl 예제:**
```bash
# 오늘 날짜 조회
curl -X GET http://mkt.techb.kr:3001/api/stats/work-tracking

# 특정 날짜 조회
curl -X GET "http://mkt.techb.kr:3001/api/stats/work-tracking?date=2025-08-09"
```

**Query Parameters:**
- `date`: 조회 날짜 (기본: 오늘)

**Response:**
```json
{
    "success": true,
    "date": "2025-08-09",
    "tracking": [
        {
            "work_slot_id": 1,
            "keyword": "무선이어폰",
            "target_count": 100,
            "allocated_count": 95,
            "completed_count": 90,
            "failed_count": 5,
            "completion_rate": 90.0
        }
    ]
}
```

---

## 6. 웹훅 API (외부 사이트 연동)

### POST `/webhook/keywords/add`
외부 사이트에서 키워드 추가

**curl 예제:**
```bash
curl -X POST http://mkt.techb.kr:3001/webhook/keywords/add \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "SITE_A",
    "auth_key": "trend-monitor-key-2025",
    "keywords": [
        {
            "keyword": "신규 트렌드 상품",
            "code": "TREND_20250809_001",
            "metadata": {
                "category": "패션",
                "priority": 8,
                "trend_score": 95
            },
            "block_mercury": false,
            "block_image_cdn": false,
            "block_img1a_cdn": false,
            "block_thumbnail_cdn": false
        }
    ]
  }'
```

**Request Body:**
```json
{
    "site_id": "SITE_A",
    "auth_key": "trend-monitor-key-2025",
    "keywords": [
        {
            "keyword": "신규 트렌드 상품",
            "code": "TREND_20250809_001",
            "metadata": {
                "category": "패션",
                "priority": 8,
                "trend_score": 95
            },
            "block_mercury": false,
            "block_image_cdn": false,
            "block_img1a_cdn": false,
            "block_thumbnail_cdn": false
        }
    ]
}
```

### PUT `/webhook/keywords/update`
키워드 수정

**curl 예제:**
```bash
curl -X PUT http://mkt.techb.kr:3001/webhook/keywords/update \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "SITE_A",
    "auth_key": "trend-monitor-key-2025",
    "keyword": "기존 키워드",
    "updates": {
        "metadata": {
            "priority": 10
        },
        "block_mercury": true
    }
  }'
```

### DELETE `/webhook/keywords/delete`
키워드 삭제

**curl 예제:**
```bash
curl -X DELETE http://mkt.techb.kr:3001/webhook/keywords/delete \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "SITE_A",
    "auth_key": "trend-monitor-key-2025",
    "keyword": "삭제할 키워드"
  }'
```
키워드 삭제

**Request Body:**
```json
{
    "site_id": "SITE_A",
    "auth_key": "trend-monitor-key-2025",
    "codes": ["TREND_20250809_001", "TREND_20250809_002"]
}
```

---

## 에러 코드

| 코드 | 설명 |
|------|------|
| `NO_WORK_AVAILABLE` | 할당 가능한 작업 없음 |
| `NO_PROXY_AVAILABLE` | 사용 가능한 프록시 없음 |
| `ALLOCATION_NOT_FOUND` | 할당 키를 찾을 수 없음 |
| `DUPLICATE_SUBMISSION` | 이미 제출된 결과 |
| `INVALID_ALLOCATION_KEY` | 잘못된 할당 키 형식 |
| `ALLOCATION_EXPIRED` | 할당 시간 만료 (120초) |
| `UNAUTHORIZED` | 인증 실패 (웹훅) |
| `PROXY_TOGGLE_COOLDOWN` | 프록시 토글 쿨다운 중 |

---

## 기본 워크플로우

### 1. 작업 할당 받기
```bash
# 기본 요청 (instance=1)
curl "http://mkt.techb.kr:3001/api/allocate-work"

# 특정 인스턴스 지정
curl "http://mkt.techb.kr:3001/api/allocate-work?instance=2"

# 서버가 자동으로 folder를 할당 (1→2→...→30→1 순환)
```

### 2. 작업 수행 (클라이언트에서 처리)
- 할당받은 키워드와 프록시를 사용하여 작업 수행
- 120초 이내에 완료해야 함

### 3. 결과 제출
```bash
curl -X POST http://mkt.techb.kr:3001/api/submit-result \
  -H "Content-Type: application/json" \
  -d '{
    "allocation_key": "WA-20250809-a1b2c3d4e5f6",
    "status": "completed",
    "execution": {
        "started_at": "2025-08-09T10:00:00Z",
        "completed_at": "2025-08-09T10:00:09Z",
        "execution_time_ms": 9000,
        "instance_number": 1,
        "user_folder": 1
    },
    "result": {
        "status": "success",
        "status_code": 200,
        "products_found": 60
    }
  }'
```

---

## 주의사항

1. **타임아웃**: 할당 후 120초 내에 결과를 제출해야 함
2. **프록시 사용**: use_count가 20에 도달하면 자동 토글
3. **쿨다운**: 프록시 토글 시 31초 글로벌 쿨다운
4. **중복 방지**: allocation_key는 고유해야 함
5. **상태 관리**: 작업 상태는 allocated → completed/expired/failed로 변경

---

## 문의 및 지원

- **서버 상태 확인**: `GET /api/health`
- **로그 확인**: PM2 로그 (`pm2 logs hub-server`)
- **데이터베이스**: PostgreSQL (mkt.techb.kr:5432)