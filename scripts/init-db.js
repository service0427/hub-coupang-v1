const { getPool, closePool } = require('../src/db/pool');

async function initDatabase() {
    const pool = getPool();
    
    try {
        // 테이블 생성
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS v1_hub_proxy_heartbeat (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                remote_ip VARCHAR(45) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        await pool.query(createTableQuery);
        console.log('✅ v1_hub_proxy_heartbeat 테이블 생성 완료');
        
        // 인덱스 생성 (성능 최적화)
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_proxy_name 
            ON v1_hub_proxy_heartbeat(name)
        `);
        console.log('✅ idx_proxy_name 인덱스 생성');
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_updated_at 
            ON v1_hub_proxy_heartbeat(updated_at DESC)
        `);
        console.log('✅ idx_updated_at 인덱스 생성');
        
        // 테이블 정보 조회
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'v1_hub_proxy_heartbeat'
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 테이블 구조:');
        tableInfo.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
        });
        
        console.log('\n✅ 데이터베이스 초기화 완료');
        
    } catch (error) {
        console.error('❌ DB 초기화 실패:', error);
        throw error;
    } finally {
        await closePool();
    }
}

// 스크립트 직접 실행시
if (require.main === module) {
    initDatabase().catch(console.error);
}

module.exports = { initDatabase };