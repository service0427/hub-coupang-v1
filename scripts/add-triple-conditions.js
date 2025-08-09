const { getPool, closePool } = require('../src/db/pool');

async function addTripleConditionTables() {
    const pool = getPool();
    
    try {
        console.log('🔄 3중 조건 시스템 테이블 추가 시작...\n');
        
        // 1. IP-키워드 제한 관리 테이블
        console.log('1️⃣ v1_hub_ip_keyword_restrictions 테이블 생성...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS v1_hub_ip_keyword_restrictions (
                id SERIAL PRIMARY KEY,
                ip_address VARCHAR(45) NOT NULL,
                keyword_id INTEGER REFERENCES v1_hub_test_keywords(id),
                proxy_number INTEGER,
                is_active BOOLEAN DEFAULT true,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ip_address, keyword_id, proxy_number)
            )
        `);
        console.log('✅ v1_hub_ip_keyword_restrictions 테이블 생성 완료');
        
        // 2. 프록시-IP 매핑 관리 테이블
        console.log('\n2️⃣ v1_hub_proxy_ip_mapping 테이블 생성...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS v1_hub_proxy_ip_mapping (
                id SERIAL PRIMARY KEY,
                proxy_id INTEGER REFERENCES v1_hub_proxies(id),
                proxy_number INTEGER NOT NULL,
                current_ip VARCHAR(45),
                is_active BOOLEAN DEFAULT true,
                last_toggle TIMESTAMP,
                heartbeat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(proxy_id, proxy_number)
            )
        `);
        console.log('✅ v1_hub_proxy_ip_mapping 테이블 생성 완료');
        
        // 3. 인덱스 생성
        console.log('\n3️⃣ 인덱스 생성...');
        
        // IP-키워드 제한 인덱스
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ip_keyword_restrictions_ip 
            ON v1_hub_ip_keyword_restrictions(ip_address)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ip_keyword_restrictions_active 
            ON v1_hub_ip_keyword_restrictions(is_active)
        `);
        
        // 프록시-IP 매핑 인덱스
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_proxy_ip_mapping_proxy 
            ON v1_hub_proxy_ip_mapping(proxy_id)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_proxy_ip_mapping_active 
            ON v1_hub_proxy_ip_mapping(is_active)
        `);
        
        console.log('✅ 인덱스 생성 완료');
        
        // 4. 샘플 데이터 삽입 (프록시 서버 정보)
        console.log('\n4️⃣ 프록시 서버 정보 초기화...');
        
        // 112.161.54.7 서버의 프록시들 등록
        const proxyPorts = [10011, 10012, 10013, 10014, 10016, 10017];
        
        for (const port of proxyPorts) {
            try {
                await pool.query(`
                    INSERT INTO v1_hub_proxies (server_ip, port, status)
                    VALUES ($1, $2, 'active')
                    ON CONFLICT (server_ip, port) DO NOTHING
                `, ['112.161.54.7', port]);
            } catch (err) {
                console.log(`  ℹ️ 포트 ${port} 이미 존재하거나 추가 실패`);
            }
        }
        console.log('✅ 프록시 정보 초기화 완료');
        
        // 5. 샘플 IP-키워드 제한 추가
        console.log('\n5️⃣ 샘플 IP-키워드 제한 추가...');
        
        // 샘플: 각 프록시 포트별로 다른 키워드 할당
        const sampleRestrictions = [
            { ip: '112.161.54.7', keyword_id: 1, proxy: 11 }, // 아이폰15
            { ip: '112.161.54.7', keyword_id: 2, proxy: 12 }, // 갤럭시S24
            { ip: '112.161.54.7', keyword_id: 3, proxy: 13 }, // 에어팟프로
        ];
        
        for (const restriction of sampleRestrictions) {
            try {
                await pool.query(`
                    INSERT INTO v1_hub_ip_keyword_restrictions 
                    (ip_address, keyword_id, proxy_number, is_active, priority)
                    VALUES ($1, $2, $3, true, 1)
                    ON CONFLICT (ip_address, keyword_id, proxy_number) DO NOTHING
                `, [restriction.ip, restriction.keyword_id, restriction.proxy]);
            } catch (err) {
                console.log(`  ℹ️ 제한 추가 실패:`, err.message);
            }
        }
        console.log('✅ 샘플 IP-키워드 제한 추가 완료');
        
        // 6. 테이블 현황 출력
        console.log('\n📋 3중 조건 시스템 테이블 현황:');
        
        const proxiesCount = await pool.query('SELECT COUNT(*) FROM v1_hub_proxies');
        const keywordsCount = await pool.query('SELECT COUNT(*) FROM v1_hub_test_keywords');
        const restrictionsCount = await pool.query('SELECT COUNT(*) FROM v1_hub_ip_keyword_restrictions');
        
        console.log(`  - 프록시: ${proxiesCount.rows[0].count}개`);
        console.log(`  - 키워드: ${keywordsCount.rows[0].count}개`);
        console.log(`  - IP-키워드 제한: ${restrictionsCount.rows[0].count}개`);
        
        console.log('\n✅ 3중 조건 시스템 테이블 추가 완료!');
        
    } catch (error) {
        console.error('❌ 테이블 추가 실패:', error);
        throw error;
    } finally {
        await closePool();
    }
}

// 스크립트 직접 실행시
if (require.main === module) {
    addTripleConditionTables().catch(console.error);
}

module.exports = { addTripleConditionTables };