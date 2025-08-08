const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 메모리 저장소
const proxies = new Map();

// 프록시 서버 heartbeat 엔드포인트
app.get('/proxy_server', (req, res) => {
    const proxyName = req.query.name;
    
    if (!proxyName) {
        return res.status(400).json({
            success: false,
            error: 'name parameter is required'
        });
    }
    
    // remote IP 추출
    const remoteIP = req.headers['x-forwarded-for'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress || 
                     'unknown';
    
    // 기존 데이터 확인
    const prev = proxies.get(proxyName);
    const now = new Date();
    
    // IP 변경 감지
    const ipChanged = prev && prev.remote_ip !== remoteIP;
    
    // 데이터 저장/업데이트
    proxies.set(proxyName, {
        name: proxyName,
        remote_ip: remoteIP,
        created_at: prev ? prev.created_at : now,
        updated_at: now
    });
    
    // 로그 출력
    const timeStr = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    if (ipChanged) {
        console.log(`🔄 IP변경 ${proxyName} [${remoteIP}] ${timeStr}`);
        console.log(`   이전: ${prev.remote_ip} → 현재: ${remoteIP}`);
    } else if (prev) {
        console.log(`✅ 업데이트 ${proxyName} [${remoteIP}] ${timeStr}`);
    } else {
        console.log(`🆕 신규등록 ${proxyName} [${remoteIP}] ${timeStr}`);
    }
    
    // 응답
    res.json({
        success: true,
        name: proxyName,
        remote_ip: remoteIP,
        ip_changed: ipChanged || false,
        timestamp: now
    });
});

// 전체 상태 조회 엔드포인트
app.get('/status', (req, res) => {
    const now = Date.now();
    const TIMEOUT_MS = 80000; // 80초
    
    const proxyList = Array.from(proxies.values()).map(proxy => {
        const lastSeenMs = now - proxy.updated_at.getTime();
        return {
            ...proxy,
            last_seen_ms_ago: lastSeenMs,
            status: lastSeenMs > TIMEOUT_MS ? 'timeout' : 'active',
            timeout: lastSeenMs > TIMEOUT_MS
        };
    });
    
    // 최근 업데이트 순으로 정렬
    proxyList.sort((a, b) => b.updated_at - a.updated_at);
    
    res.json({
        success: true,
        total: proxyList.length,
        active: proxyList.filter(p => !p.timeout).length,
        timeout: proxyList.filter(p => p.timeout).length,
        proxies: proxyList,
        timestamp: new Date()
    });
});

// 서버 시작
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 허브 서버 시작 (메모리 버전): http://localhost:${PORT}`);
    console.log(`📊 상태 조회: http://localhost:${PORT}/status`);
    console.log(`🔄 프록시 등록: http://localhost:${PORT}/proxy_server?name=프록시이름`);
    console.log('\n⚠️  메모리 버전: 서버 재시작시 데이터가 초기화됩니다');
});

// 종료 처리
process.on('SIGINT', () => {
    console.log('\n🛑 서버 종료...');
    console.log(`📊 총 ${proxies.size}개 프록시 추적 중이었습니다`);
    process.exit(0);
});