const express = require('express');
const cors = require('cors');
const { getPool, getPoolStats, testConnection, closePool } = require('./db/pool');
const proxyRoutes = require('./routes/proxy');
const allocationRoutes = require('./routes/allocation');
const { getMonitor } = require('./monitor/proxy-monitor');
const { getToggleQueue } = require('./services/toggle-queue');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// API 라우트
app.use('/api/proxy', proxyRoutes);
app.use('/api/allocation', allocationRoutes);

// 새 시스템 라우트
const workSlotsRoutes = require('./routes/work-slots');
const workAllocationRoutes = require('./routes/work-allocation');
const submitResultRoutes = require('./routes/submit-result');

app.use('/api/work-slots', workSlotsRoutes);
app.use('/api/allocate-work', workAllocationRoutes);
app.use('/api/submit-result', submitResultRoutes);

// 통계 저장용
const stats = {
    totalRequests: 0,
    ipChanges: 0,
    startTime: new Date()
};

// 프록시 서버 heartbeat 엔드포인트
app.get('/proxy_server', async (req, res) => {
    const pool = getPool();
    const proxyName = req.query.name;
    
    if (!proxyName) {
        return res.status(400).json({
            success: false,
            error: 'name parameter is required'
        });
    }
    
    // 요청 정보 추출
    let remoteIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress || 
                   'unknown';
    
    // IPv4-mapped IPv6 주소에서 ::ffff: 제거
    if (remoteIP.startsWith('::ffff:')) {
        remoteIP = remoteIP.substring(7);
    }
    
    try {
        // 트랜잭션 시작
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 기존 데이터 조회
            const selectQuery = 'SELECT * FROM v1_hub_proxy_heartbeat WHERE name = $1 FOR UPDATE';
            const selectResult = await client.query(selectQuery, [proxyName]);
            const prev = selectResult.rows[0];
            
            // IP 변경 감지
            const ipChanged = prev && prev.remote_ip !== remoteIP;
            
            let result;
            if (prev) {
                // 업데이트
                const updateQuery = `
                    UPDATE v1_hub_proxy_heartbeat 
                    SET remote_ip = $2, 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE name = $1
                    RETURNING *
                `;
                result = await client.query(updateQuery, [proxyName, remoteIP]);
            } else {
                // 신규 삽입
                const insertQuery = `
                    INSERT INTO v1_hub_proxy_heartbeat (name, remote_ip)
                    VALUES ($1, $2)
                    RETURNING *
                `;
                result = await client.query(insertQuery, [proxyName, remoteIP]);
            }
            
            await client.query('COMMIT');
            
            const updatedProxy = result.rows[0];
            
            // 통계 업데이트
            stats.totalRequests++;
            if (ipChanged) stats.ipChanges++;
            
            // 로그 출력
            const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            if (ipChanged) {
                console.log(`🔄 IP변경 ${proxyName} [${remoteIP}] ${now}`);
                console.log(`   이전: ${prev.remote_ip} → 현재: ${remoteIP}`);
            } else if (prev) {
                console.log(`✅ 업데이트 ${proxyName} [${remoteIP}] ${now}`);
            } else {
                console.log(`🆕 신규등록 ${proxyName} [${remoteIP}] ${now}`);
            }
            
            // 응답
            res.json({
                success: true,
                name: proxyName,
                remote_ip: remoteIP,
                ip_changed: ipChanged || false,
                timestamp: updatedProxy.updated_at
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ DB 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 전체 상태 조회 엔드포인트
app.get('/status', async (req, res) => {
    const pool = getPool();
    
    try {
        const query = `
            SELECT 
                name,
                remote_ip,
                updated_at as last_seen,
                created_at,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 as last_seen_ms_ago
            FROM v1_hub_proxy_heartbeat
            ORDER BY updated_at DESC
        `;
        
        const result = await pool.query(query);
        
        // 80초(80000ms) 타임아웃 체크
        const TIMEOUT_MS = 80000;
        const proxies = result.rows.map(proxy => ({
            ...proxy,
            status: proxy.last_seen_ms_ago > TIMEOUT_MS ? 'timeout' : 'active',
            timeout: proxy.last_seen_ms_ago > TIMEOUT_MS
        }));
        
        // 통계 추가
        const uptime = Date.now() - stats.startTime.getTime();
        const poolStats = getPoolStats();
        
        res.json({
            success: true,
            total: proxies.length,
            active: proxies.filter(p => !p.timeout).length,
            timeout: proxies.filter(p => p.timeout).length,
            stats: {
                totalRequests: stats.totalRequests,
                ipChanges: stats.ipChanges,
                uptimeMs: uptime,
                avgRequestsPerMin: stats.totalRequests / (uptime / 60000)
            },
            pool: poolStats,
            proxies: proxies,
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error('❌ 상태 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 특정 프록시 상세 조회
app.get('/proxy/:name', async (req, res) => {
    const pool = getPool();
    const { name } = req.params;
    
    try {
        const query = `
            SELECT 
                *,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 as last_seen_ms_ago
            FROM v1_hub_proxy_heartbeat
            WHERE name = $1
        `;
        
        const result = await pool.query(query, [name]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Proxy not found'
            });
        }
        
        const proxy = result.rows[0];
        const TIMEOUT_MS = 80000;
        
        res.json({
            success: true,
            proxy: {
                ...proxy,
                status: proxy.last_seen_ms_ago > TIMEOUT_MS ? 'timeout' : 'active',
                timeout: proxy.last_seen_ms_ago > TIMEOUT_MS
            }
        });
        
    } catch (error) {
        console.error('❌ 프록시 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 모니터링 통계
app.get('/monitor/stats', (req, res) => {
    const monitor = getMonitor();
    const stats = monitor.getStats();
    res.json({
        success: true,
        monitor: stats
    });
});

// 토글 큐 상태
app.get('/api/toggle/queue', (req, res) => {
    const toggleQueue = getToggleQueue();
    const status = toggleQueue.getStatus();
    res.json({
        success: true,
        queue: status
    });
});

// 토글 큐 클리어
app.delete('/toggle/queue', (req, res) => {
    const toggleQueue = getToggleQueue();
    const clearedCount = toggleQueue.clearQueue();
    res.json({
        success: true,
        message: `${clearedCount}개 큐 항목 제거됨`
    });
});

// 타임아웃 통계
app.get('/api/timeout/stats', async (req, res) => {
    const timeoutManager = getTimeoutManager();
    const stats = await timeoutManager.getStats();
    res.json({
        success: true,
        stats: stats
    });
});

// 할당 시간 연장
app.post('/api/allocations/:allocation_key/extend', async (req, res) => {
    const { allocation_key } = req.params;
    const { seconds = 60 } = req.body;
    
    const timeoutManager = getTimeoutManager();
    const newExpiry = await timeoutManager.extendAllocation(allocation_key, seconds);
    
    if (newExpiry) {
        res.json({
            success: true,
            expires_at: newExpiry,
            message: `할당 시간이 ${seconds}초 연장되었습니다`
        });
    } else {
        res.status(404).json({
            success: false,
            error: '할당을 찾을 수 없거나 이미 만료되었습니다'
        });
    }
});

// 프록시 동기화 수동 실행
app.post('/api/proxy/sync', async (req, res) => {
    const proxySync = getProxySync();
    const result = await proxySync.syncProxies();
    
    if (result.success) {
        res.json({
            success: true,
            message: '프록시 동기화 완료',
            active: result.active,
            inactive: result.inactive,
            total: result.total
        });
    } else {
        res.status(500).json({
            success: false,
            error: result.error
        });
    }
});

// 프록시 실시간 상태 확인
app.get('/api/proxy/real-status', async (req, res) => {
    const proxySync = getProxySync();
    const proxies = await proxySync.fetchActiveProxies();
    
    res.json({
        success: true,
        count: proxies.length,
        proxies: proxies
    });
});

// 헬스체크
app.get('/health', async (req, res) => {
    const pool = getPool();
    const poolStats = getPoolStats();
    
    try {
        await pool.query('SELECT 1');
        res.json({
            success: true,
            status: 'healthy',
            database: 'connected',
            uptime: Date.now() - stats.startTime.getTime(),
            pool: poolStats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            pool: poolStats
        });
    }
});

// 서버 시작
const PORT = process.env.PORT || 3001;
const { getTimeoutManager } = require('./services/allocation-timeout');
const { getProxySync } = require('./services/proxy-sync');

async function startServer() {
    try {
        // DB 연결 테스트
        const connected = await testConnection();
        if (!connected) {
            throw new Error('DB 연결 실패');
        }
        
        // 프록시 동기화 시작
        const proxySync = getProxySync();
        await proxySync.syncProxies(); // 초기 동기화
        proxySync.startAutoSync(60000); // 60초마다 자동 동기화
        
        // 프록시 모니터링 시작
        const monitor = getMonitor();
        monitor.start(30000); // 30초마다 체크
        
        // 할당 타임아웃 매니저 시작
        const timeoutManager = getTimeoutManager();
        timeoutManager.start();
        
        app.listen(PORT, () => {
            console.log(`🚀 허브 서버 시작 (Pool 버전): http://localhost:${PORT}`);
            console.log(`📊 상태 조회: http://localhost:${PORT}/status`);
            console.log(`🔄 프록시 등록: http://localhost:${PORT}/proxy_server?name=프록시이름`);
            console.log(`💚 헬스체크: http://localhost:${PORT}/health`);
            console.log(`🎯 모니터링: 30초마다 프록시 상태 체크`);
            console.log(`🔄 동기화: 60초마다 프록시 서버와 동기화`);
            console.log(`⏰ 타임아웃: 120초 후 자동 만료 처리`);
            console.log('\n⚡ DB 연결 풀 사용중 (최대 20개 연결)');
        });
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// 종료 처리
process.on('SIGINT', async () => {
    console.log('\n🛑 서버 종료 중...');
    console.log(`📊 총 요청: ${stats.totalRequests}, IP 변경: ${stats.ipChanges}`);
    
    // 프록시 동기화 중지
    const proxySync = getProxySync();
    proxySync.stopAutoSync();
    
    // 모니터링 중지
    const monitor = getMonitor();
    monitor.stop();
    
    // 타임아웃 매니저 중지
    const timeoutManager = getTimeoutManager();
    timeoutManager.stop();
    
    await closePool();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    // 프록시 동기화 중지
    const proxySync = getProxySync();
    proxySync.stopAutoSync();
    
    // 모니터링 중지
    const monitor = getMonitor();
    monitor.stop();
    
    // 타임아웃 매니저 중지
    const timeoutManager = getTimeoutManager();
    timeoutManager.stop();
    
    await closePool();
    process.exit(0);
});

// 예외 처리
process.on('uncaughtException', (error) => {
    console.error('❌ 예외 발생:', error);
    closePool().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise 거부:', reason);
    closePool().then(() => process.exit(1));
});

startServer();