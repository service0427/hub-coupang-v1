const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL 연결 설정
const dbClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

// DB 연결 및 테이블 생성
async function initDatabase() {
    try {
        await dbClient.connect();
        console.log('✅ PostgreSQL 연결 성공');
        
        // 테이블 생성 (없을 경우)
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS proxy_heartbeat (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                remote_ip VARCHAR(45) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        await dbClient.query(createTableQuery);
        console.log('✅ proxy_heartbeat 테이블 준비 완료');
    } catch (error) {
        console.error('❌ DB 초기화 실패:', error);
        process.exit(1);
    }
}

// 프록시 서버 heartbeat 엔드포인트
app.get('/proxy_server', async (req, res) => {
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
    
    try {
        // 기존 데이터 조회
        const selectQuery = 'SELECT * FROM proxy_heartbeat WHERE name = $1';
        const selectResult = await dbClient.query(selectQuery, [proxyName]);
        const prev = selectResult.rows[0];
        
        // IP 변경 감지
        const ipChanged = prev && prev.remote_ip !== remoteIP;
        
        // UPSERT 쿼리
        const upsertQuery = `
            INSERT INTO proxy_heartbeat (name, remote_ip, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (name)
            DO UPDATE SET 
                remote_ip = $2, 
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        
        const result = await dbClient.query(upsertQuery, [proxyName, remoteIP]);
        const updatedProxy = result.rows[0];
        
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
        console.error('❌ DB 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

// 전체 상태 조회 엔드포인트
app.get('/status', async (req, res) => {
    try {
        const query = `
            SELECT 
                name,
                remote_ip,
                updated_at as last_seen,
                created_at,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 as last_seen_ms_ago
            FROM proxy_heartbeat
            ORDER BY updated_at DESC
        `;
        
        const result = await dbClient.query(query);
        
        // 80초(80000ms) 타임아웃 체크
        const TIMEOUT_MS = 80000;
        const proxies = result.rows.map(proxy => ({
            ...proxy,
            status: proxy.last_seen_ms_ago > TIMEOUT_MS ? 'timeout' : 'active',
            timeout: proxy.last_seen_ms_ago > TIMEOUT_MS
        }));
        
        res.json({
            success: true,
            total: proxies.length,
            active: proxies.filter(p => !p.timeout).length,
            timeout: proxies.filter(p => p.timeout).length,
            proxies: proxies,
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error('❌ 상태 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

// 서버 시작
const PORT = process.env.PORT || 3001;

async function startServer() {
    await initDatabase();
    
    app.listen(PORT, () => {
        console.log(`🚀 허브 서버 시작: http://localhost:${PORT}`);
        console.log(`📊 상태 조회: http://localhost:${PORT}/status`);
        console.log(`🔄 프록시 등록: http://localhost:${PORT}/proxy_server?name=프록시이름`);
    });
}

// 종료 처리
process.on('SIGINT', async () => {
    console.log('\n🛑 서버 종료 중...');
    await dbClient.end();
    process.exit(0);
});

startServer();