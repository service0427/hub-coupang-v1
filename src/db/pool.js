const { Pool } = require('pg');
require('dotenv').config();

// 싱글톤 패턴으로 Pool 인스턴스 관리
let pool = null;
let poolStats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    errors: 0,
    lastError: null
};

function getPool() {
    if (!pool) {
        pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            max: 10,                    // 최대 연결 수 (최적화)
            min: 2,                     // 최소 연결 수
            idleTimeoutMillis: 60000,   // 유휴 연결 타임아웃 (60초)
            connectionTimeoutMillis: 3000, // 연결 타임아웃 (3초)
            maxUses: 7500,              // 연결당 최대 사용 횟수
            allowExitOnIdle: false      // 유휴 상태에서도 프로세스 유지
        });
        
        // 에러 핸들링
        pool.on('error', (err) => {
            poolStats.errors++;
            poolStats.lastError = err.message;
            console.error(`❌ DB Pool 에러 [${poolStats.errors}]:`, err.message);
        });
        
        pool.on('connect', () => {
            poolStats.totalConnections++;
            poolStats.activeConnections = pool.totalCount;
            poolStats.idleConnections = pool.idleCount;
            // 디버그 모드에서만 로그 출력
            if (process.env.DEBUG === 'true') {
                console.log(`📌 DB 연결 생성 (활성: ${poolStats.activeConnections}, 대기: ${poolStats.idleConnections})`);
            }
        });
        
        pool.on('remove', () => {
            poolStats.activeConnections = pool.totalCount;
            poolStats.idleConnections = pool.idleCount;
            // 디버그 모드에서만 로그 출력
            if (process.env.DEBUG === 'true') {
                console.log(`📤 DB 연결 제거 (활성: ${poolStats.activeConnections}, 대기: ${poolStats.idleConnections})`);
            }
        });
    }
    
    return pool;
}

// Pool 상태 조회
function getPoolStats() {
    if (pool) {
        return {
            ...poolStats,
            currentTotal: pool.totalCount,
            currentIdle: pool.idleCount,
            currentWaiting: pool.waitingCount
        };
    }
    return poolStats;
}

// DB 연결 테스트 함수
async function testConnection() {
    const pool = getPool();
    
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ DB 연결 성공:', result.rows[0].now);
        return true;
    } catch (error) {
        console.error('❌ DB 연결 실패:', error);
        return false;
    }
}

// 연결 종료 함수
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('🔒 DB Pool 종료');
    }
}

module.exports = {
    getPool,
    getPoolStats,
    testConnection,
    closePool
};