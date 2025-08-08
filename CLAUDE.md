# CLAUDE.md

이 파일은 Claude Code (claude.ai/code)가 이 저장소에서 작업할 때 참고할 가이드라인을 제공합니다.

## 프로젝트 상태

현재 초기화 중인 새 프로젝트 디렉토리입니다. 프로젝트가 개발되면서 아래 정보를 업데이트해야 합니다.

## 개발 명령어

*프로젝트가 초기화되면 결정될 예정입니다. 일반적인 명령어들:*

```bash
# 프로젝트 설정 (선택한 기술 스택에 따라 업데이트)
npm install       # 또는 yarn install

# 개발 서버 실행
npm run dev       # 또는 yarn dev

# 빌드
npm run build     # 또는 yarn build

# 테스트
npm test          # 또는 yarn test

# 린팅
npm run lint      # 또는 yarn lint
```

## 프로젝트 아키텍처

*프로젝트 구조가 확립되면 문서화 예정*

## 중요 사항

- 쿠팡(한국 이커머스 플랫폼) 관련 프로젝트로 보임 (디렉토리 이름 기준)
- 현재 프로젝트는 초기화되지 않은 상태이며 설정이 필요함
- 프로젝트 구조와 요구사항이 명확해지면 이 파일을 업데이트할 것
- **대화는 한국어로 진행**

## 데이터베이스 설정

PostgreSQL 데이터베이스 설정:

```javascript
database: {
  host: 'mkt.techb.kr',
  port: 5432,
  database: 'coupang_test',
  user: 'techb_pp',
  password: 'Tech1324!'
}
```

**참고**: 현재 `mkt.techb.kr` 서버에서 호스팅되고 있으나 추후 분리될 가능성이 있음

## 시스템 접근

- sudo 비밀번호: Tech1324!

## 초기 설정 단계

1. 버전 관리 초기화: `git init`
2. 기술 스택 선택 및 설정 (React, Vue, Node.js 백엔드 등)
3. 필요한 의존성과 함께 package.json 생성
4. 프로젝트 구조 설정 (src/, components/ 등)
5. 빌드 도구, 린터, 포맷터 설정
6. 실제 프로젝트별 정보로 이 CLAUDE.md 파일 업데이트