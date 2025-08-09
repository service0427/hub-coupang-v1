# 쿠팡 허브 서버 v1.0

실시간 작업 분배 및 프록시 관리 중앙 허브 서버

## 🚀 시작하기

### 사전 요구사항
- Node.js 18 이상
- PostgreSQL 13 이상
- PM2 (글로벌 설치: `npm install -g pm2`)

### 설치

```bash
# 1. 의존성 설치
npm install

# 2. 데이터베이스 초기화 (최초 1회)
node scripts/init-db.js

# 3. 서버 시작
./start.sh
```

## 📡 API 엔드포인트

전체 API 문서: [API_DOCUMENTATION.md](API_DOCUMENTATION.md)

주요 엔드포인트:
- `POST /api/allocate` - 작업 할당
- `POST /api/submit-result` - 결과 제출
- `GET /api/proxy/status` - 프록시 상태
- `GET /api/stats/dashboard` - 대시보드 통계

## 🗄️ 데이터베이스 설정

```javascript
{
  host: 'mkt.techb.kr',
  port: 5432,
  database: 'coupang_test',
  user: 'techb_pp',
  password: 'Tech1324!'
}
```

## 📊 모니터링

```bash
# PM2 모니터링
pm2 monit

# 로그 확인
pm2 logs hub-server

# 프로세스 상태
pm2 status

# 서버 재시작
pm2 restart hub-server

# 서버 중지
pm2 stop hub-server
```

## 🏗️ 프로젝트 구조

```
hub-coupang-v1/
├── src/
│   ├── server.js           # 메인 서버
│   ├── db/                 # 데이터베이스 연결
│   ├── routes/             # API 라우트
│   ├── services/           # 비즈니스 로직
│   └── utils/              # 유틸리티
├── sql/                    # 데이터베이스 스키마
├── scripts/                # 유지보수 스크립트
├── docs/                   # 기술 문서
└── ecosystem.config.js     # PM2 설정
```

## ⚙️ 주요 기능

- **작업 할당**: 키워드 + 프록시 자동 할당
- **120초 타임아웃**: 미완료 작업 자동 재할당
- **프록시 관리**: 자동 IP 토글 (use_count >= 20)
- **외부 사이트 연동**: 웹훅 기반 키워드 관리
- **실시간 모니터링**: 통계 및 상태 대시보드

## 📝 유지보수

### 일일 백업 (자동화됨)
```bash
# cron 설정 확인
crontab -l
```

### 수동 아카이브
```bash
./scripts/daily-archive.sh
```

## 🔧 트러블슈팅

### 서버가 시작되지 않을 때
```bash
# PM2 프로세스 정리
pm2 delete all
pm2 start ecosystem.config.js
```

### 데이터베이스 연결 오류
```bash
# PostgreSQL 서비스 확인
sudo systemctl status postgresql
```

## 📞 지원

기술 지원이 필요한 경우 시스템 관리자에게 문의하세요.

---
*Production Ready v1.0*