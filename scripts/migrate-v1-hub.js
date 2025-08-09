const { getPool, closePool } = require('../src/db/pool');

async function migrateToV1Hub() {
    const pool = getPool();
    
    try {
        console.log('🔄 v1_hub_ 테이블 마이그레이션 시작...\n');
        
        // 1. proxy_heartbeat 테이블명 변경
        console.log('1️⃣ proxy_heartbeat 테이블명 변경...');
        try {
            await pool.query('ALTER TABLE proxy_heartbeat RENAME TO v1_hub_proxy_heartbeat');
            console.log('✅ v1_hub_proxy_heartbeat로 변경 완료');
        } catch (error) {
            if (error.code === '42P01') {
                console.log('ℹ️ proxy_heartbeat 테이블이 없거나 이미 변경됨');
            } else if (error.code === '42P07') {
                console.log('ℹ️ v1_hub_proxy_heartbeat 테이블이 이미 존재');
            } else {
                throw error;
            }
        }
        
        // 2. v1_hub_test_keywords 테이블 생성
        console.log('\n2️⃣ v1_hub_test_keywords 테이블 생성...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS v1_hub_test_keywords (
                id SERIAL PRIMARY KEY,
                keyword VARCHAR(255) NOT NULL,
                code VARCHAR(100),
                option VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ v1_hub_test_keywords 테이블 생성 완료');
        
        // 3. v1_hub_proxies 테이블 생성
        console.log('\n3️⃣ v1_hub_proxies 테이블 생성...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS v1_hub_proxies (
                id SERIAL PRIMARY KEY,
                server_ip VARCHAR(45) NOT NULL,
                port INTEGER NOT NULL,
                external_ip VARCHAR(45),
                use_count INTEGER DEFAULT 0,
                last_used_at TIMESTAMP,
                last_toggle_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_ip, port)
            )
        `);
        console.log('✅ v1_hub_proxies 테이블 생성 완료');
        
        // 4. v1_hub_proxy_usage 테이블 생성
        console.log('\n4️⃣ v1_hub_proxy_usage 테이블 생성...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS v1_hub_proxy_usage (
                id SERIAL PRIMARY KEY,
                proxy_id INTEGER REFERENCES v1_hub_proxies(id),
                keyword_id INTEGER REFERENCES v1_hub_test_keywords(id),
                used_ip VARCHAR(45),
                success BOOLEAN DEFAULT true,
                response_time_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ v1_hub_proxy_usage 테이블 생성 완료');
        
        // 5. 인덱스 생성
        console.log('\n5️⃣ 인덱스 생성...');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_v1_hub_proxies_status ON v1_hub_proxies(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_v1_hub_proxies_use_count ON v1_hub_proxies(use_count)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_v1_hub_proxy_usage_keyword ON v1_hub_proxy_usage(keyword_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_v1_hub_proxy_usage_created ON v1_hub_proxy_usage(created_at DESC)');
        console.log('✅ 인덱스 생성 완료');
        
        // 6. 샘플 키워드 데이터 삽입
        console.log('\n6️⃣ 샘플 키워드 데이터 삽입...');
        const checkKeywords = await pool.query('SELECT COUNT(*) FROM v1_hub_test_keywords');
        if (checkKeywords.rows[0].count == 0) {
            await pool.query(`
                INSERT INTO v1_hub_test_keywords (keyword, code, option) VALUES
                ('아이폰15', 'IP15', 'latest'),
                ('갤럭시S24', 'GS24', 'popular'),
                ('에어팟프로', 'APP', 'bestseller'),
                ('노트북', 'NB', 'general'),
                ('태블릿', 'TB', 'trending')
            `);
            console.log('✅ 샘플 키워드 5개 삽입 완료');
        } else {
            console.log('ℹ️ 키워드가 이미 존재합니다');
        }
        
        // 7. 테이블 목록 확인
        console.log('\n📋 생성된 v1_hub_ 테이블 목록:');
        const tables = await pool.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public' 
            AND tablename LIKE 'v1_hub_%'
            ORDER BY tablename
        `);
        tables.rows.forEach(t => console.log(`  - ${t.tablename}`));
        
        console.log('\n✅ 마이그레이션 완료!');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
        throw error;
    } finally {
        await closePool();
    }
}

// 스크립트 직접 실행시
if (require.main === module) {
    migrateToV1Hub().catch(console.error);
}

module.exports = { migrateToV1Hub };