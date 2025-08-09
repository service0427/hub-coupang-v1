# API 명세서

## 1. 작업 슬롯 관리

### 1.1 작업 슬롯 생성
**POST** `/api/work-slots`

#### Request
```json
{
    "keyword": "노트북",
    "code": "12345",
    "start_date": "2024-01-01",
    "end_date": "2024-01-31",
    "daily_work_count": 100,
    "cart_click_enabled": false,
    "block_mercury": false,
    "block_image_cdn": false,
    "block_img1a_cdn": false,
    "block_thumbnail_cdn": true
}
```

#### Response
```json
{
    "success": true,
    "slot_id": 1,
    "message": "작업 슬롯이 생성되었습니다"
}
```

### 1.2 작업 슬롯 조회
**GET** `/api/work-slots`

#### Query Parameters
- `status`: active, pending, expired (선택)
- `date`: YYYY-MM-DD (선택)

#### Response
```json
{
    "success": true,
    "slots": [
        {
            "id": 1,
            "keyword": "노트북",
            "code": "12345",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
            "daily_work_count": 100,
            "status": "active",
            "today_progress": {
                "target": 100,
                "completed": 45,
                "failed": 2,
                "completion_rate": 45.0
            }
        }
    ]
}
```

### 1.3 블록 설정 수정
**PATCH** `/api/work-slots/:id/settings`

#### Request
```json
{
    "cart_click_enabled": true,
    "block_mercury": true,
    "block_image_cdn": false,
    "block_img1a_cdn": false,
    "block_thumbnail_cdn": false
}
```

#### Response
```json
{
    "success": true,
    "message": "설정이 업데이트되었습니다"
}
```

## 2. 작업 할당

### 2.1 작업 할당 요청
**GET** `/api/allocate-work`

#### Headers
- `X-Client-IP`: 자동 감지 (선택)
- `X-Instance-Number`: 인스턴스 번호 (선택)
- `X-User-Folder`: 유저 폴더 번호 (선택)

#### Response
```json
{
    "success": true,
    "allocation_key": "WA-20240101-001234",
    "work": {
        "keyword": "노트북",
        "code": "12345"
    },
    "proxy": {
        "ip": "175.223.18.58",
        "port": 10012,
        "type": "socks5"
    },
    "settings": {
        "cart_click_enabled": false,
        "block_mercury": false,
        "block_image_cdn": false,
        "block_img1a_cdn": false,
        "block_thumbnail_cdn": true
    },
    "expires_at": "2024-01-01T10:05:00Z"
}
```

#### Error Response
```json
{
    "success": false,
    "error": "NO_WORK_AVAILABLE",
    "message": "현재 할당 가능한 작업이 없습니다"
}
```

### 2.2 할당 상태 확인
**GET** `/api/allocations/:allocation_key`

#### Response
```json
{
    "success": true,
    "allocation": {
        "key": "WA-20240101-001234",
        "status": "allocated",
        "allocated_at": "2024-01-01T10:00:00Z",
        "expires_at": "2024-01-01T10:05:00Z"
    }
}
```

## 3. 결과 제출

### 3.1 작업 결과 제출
**POST** `/api/submit-result`

#### Request
```json
{
    "allocation_key": "WA-20240101-001234",
    "execution": {
        "started_at": "2024-01-01T10:00:00Z",
        "completed_at": "2024-01-01T10:00:05Z",
        "execution_time_ms": 5000,
        "instance_number": 3,
        "user_folder": 17
    },
    "applied_settings": {
        "cart_click_enabled": false,
        "block_mercury": false,
        "block_image_cdn": false,
        "block_img1a_cdn": false,
        "block_thumbnail_cdn": true
    },
    "result": {
        "status": "success",
        "status_code": 200,
        "current_page": 1
    },
    "products": [
        {
            "product_id": 1234567890,
            "product_name": "삼성 갤럭시북3",
            "rating": 4.5,
            "review_count": 234
        }
    ],
    "performance": {
        "page_load_time_ms": 2500,
        "dom_ready_time_ms": 1200,
        "first_product_time_ms": 1800,
        "total_requests": 125,
        "blocked_requests": 3
    },
    "block_info": null
}
```

#### Response
```json
{
    "success": true,
    "result_id": 456,
    "message": "결과가 저장되었습니다"
}
```

### 3.2 블록 발생 보고
**POST** `/api/submit-result`

#### Request (블록 발생 시)
```json
{
    "allocation_key": "WA-20240101-001234",
    "execution": {
        "started_at": "2024-01-01T10:00:00Z",
        "completed_at": "2024-01-01T10:00:02Z",
        "execution_time_ms": 2000,
        "instance_number": 3,
        "user_folder": 17
    },
    "applied_settings": {
        "cart_click_enabled": false,
        "block_mercury": false,
        "block_image_cdn": false,
        "block_img1a_cdn": false,
        "block_thumbnail_cdn": true
    },
    "result": {
        "status": "blocked",
        "status_code": 403
    },
    "block_info": {
        "block_type": "captcha",
        "block_source": "cloudflare",
        "error_message": "Please complete the CAPTCHA",
        "detected_at": "2024-01-01T10:00:01.500Z"
    }
}
```

## 4. 모니터링

### 4.1 대시보드 데이터
**GET** `/api/dashboard`

#### Response
```json
{
    "success": true,
    "summary": {
        "active_slots": 5,
        "today_target": 500,
        "today_completed": 234,
        "today_failed": 12,
        "overall_success_rate": 95.1
    },
    "slots": [...],
    "clients": [
        {
            "ip": "192.168.1.100",
            "name": "server-01",
            "status": "online",
            "active_instances": 8,
            "recent_success_rate": 96.5
        }
    ]
}
```

### 4.2 클라이언트 상태
**GET** `/api/clients`

#### Response
```json
{
    "success": true,
    "clients": [
        {
            "client_ip": "192.168.1.100",
            "client_name": "server-01",
            "first_seen_at": "2024-01-01T00:00:00Z",
            "last_seen_at": "2024-01-01T10:00:00Z",
            "observed_max_instance": 8,
            "observed_max_user_folder": 30,
            "total_requests": 1234,
            "status": "online"
        }
    ]
}
```

### 4.3 설정별 성능 분석
**GET** `/api/analytics/settings`

#### Query Parameters
- `start_date`: YYYY-MM-DD
- `end_date`: YYYY-MM-DD

#### Response
```json
{
    "success": true,
    "analysis": [
        {
            "settings": {
                "cart_click_enabled": false,
                "block_mercury": false,
                "block_image_cdn": false,
                "block_img1a_cdn": false,
                "block_thumbnail_cdn": true
            },
            "metrics": {
                "total_executions": 1000,
                "success_rate": 95.5,
                "block_rate": 2.1,
                "avg_execution_time_ms": 2500
            }
        }
    ]
}
```

## 5. 에러 코드

| 코드 | 설명 | HTTP Status |
|------|------|-------------|
| NO_WORK_AVAILABLE | 할당 가능한 작업 없음 | 404 |
| INVALID_ALLOCATION_KEY | 잘못된 할당 키 | 400 |
| ALLOCATION_EXPIRED | 할당 시간 만료 | 410 |
| DUPLICATE_SUBMISSION | 중복 결과 제출 | 409 |
| INVALID_DATE_RANGE | 잘못된 날짜 범위 | 400 |
| PROXY_NOT_AVAILABLE | 사용 가능한 프록시 없음 | 503 |
| CLIENT_NOT_REGISTERED | 등록되지 않은 클라이언트 | 401 |
| QUOTA_EXCEEDED | 일별 할당량 초과 | 429 |

## 6. 인증 및 보안

### 6.1 클라이언트 인증
- IP 기반 자동 인증
- 추후 API 키 방식 추가 가능

### 6.2 Rate Limiting
- 클라이언트당 분당 60회 요청 제한
- 할당 API는 분당 10회 제한

### 6.3 데이터 보안
- HTTPS 필수
- 민감 정보 암호화 저장

## 7. Webhook (추후 구현)

### 7.1 작업 완료 알림
```json
POST {callback_url}
{
    "event": "work_completed",
    "slot_id": 1,
    "date": "2024-01-01",
    "completed_count": 100,
    "success_rate": 95.0
}
```

### 7.2 블록 발생 알림
```json
POST {callback_url}
{
    "event": "block_detected",
    "slot_id": 1,
    "block_type": "captcha",
    "frequency": 5,
    "timestamp": "2024-01-01T10:00:00Z"
}
```