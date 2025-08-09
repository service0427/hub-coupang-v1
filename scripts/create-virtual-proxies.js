const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

// 가상 프록시 생성 스크립트
async function createVirtualProxies(count = 500, startPort = 20000) {
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    });

    console.log('🎮 가상 프록시 생성 시작');
    console.log('═'.repeat(60));
    
    try {
        // 기존 가상 프록시 삭제
        console.log('🗑️  기존 가상 프록시 삭제 중...');
        
        // 먼저 IP 매핑 삭제
        await pool.query(`
            DELETE FROM v1_hub_proxy_ip_mapping 
            WHERE proxy_id IN (
                SELECT id FROM v1_hub_proxies 
                WHERE server_ip LIKE '10.%' 
                   OR server_ip LIKE '192.168.%'
                   OR port >= 20000
            )
        `);
        
        // 그 다음 프록시 삭제
        const deleteResult = await pool.query(`
            DELETE FROM v1_hub_proxies 
            WHERE server_ip LIKE '10.%' 
               OR server_ip LIKE '192.168.%'
               OR port >= 20000
        `);
        console.log(`   ${deleteResult.rowCount}개 삭제됨`);
        
        console.log('\n📝 새로운 가상 프록시 생성 중...');
        
        const proxies = [];
        const ipMappings = [];
        
        for (let i = 0; i < count; i++) {
            // 가상 서버 IP 생성 (10.x.x.x 대역)
            const serverIp = `10.${Math.floor(i / 250)}.${(i % 250) + 1}.1`;
            const port = startPort + i;
            
            // 가상 외부 IP 생성
            const externalIp = `203.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
            
            proxies.push({
                server_ip: serverIp,
                port: port,
                external_ip: externalIp,
                use_count: 0,
                status: 'active',
                is_virtual: true,  // 가상 프록시 표시
                proxy_type: 'socks5',
                last_toggle_at: new Date()
            });
            
            // 진행 상황 표시
            if ((i + 1) % 50 === 0) {
                process.stdout.write(`\r   생성 중: ${i + 1}/${count} (${Math.round((i + 1) / count * 100)}%)`);
            }
        }
        
        console.log(`\n\n💾 데이터베이스에 저장 중...`);
        
        // 배치 삽입
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 프록시 삽입
            for (const proxy of proxies) {
                const result = await client.query(`
                    INSERT INTO v1_hub_proxies (
                        server_ip, port, external_ip, use_count, 
                        status, last_toggle_at, 
                        created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, 
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    ) RETURNING id
                `, [
                    proxy.server_ip,
                    proxy.port,
                    proxy.external_ip,
                    proxy.use_count,
                    proxy.status,
                    proxy.last_toggle_at
                ]);
                
                // IP 매핑 추가
                await client.query(`
                    INSERT INTO v1_hub_proxy_ip_mapping (
                        proxy_id, proxy_number, current_ip, 
                        last_toggle, is_active, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, true, CURRENT_TIMESTAMP
                    )
                `, [
                    result.rows[0].id,
                    1,  // 프록시 번호
                    proxy.external_ip,
                    proxy.last_toggle_at
                ]);
            }
            
            await client.query('COMMIT');
            console.log(`✅ ${proxies.length}개 가상 프록시 생성 완료!`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
        // 통계 출력
        console.log('\n📊 생성된 가상 프록시 통계:');
        console.log('─'.repeat(40));
        
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN port >= 20000 THEN 1 END) as virtual_count,
                COUNT(CASE WHEN port < 20000 THEN 1 END) as real_count,
                MIN(port) as min_port,
                MAX(port) as max_port
            FROM v1_hub_proxies
            WHERE status = 'active'
        `);
        
        const stats = statsResult.rows[0];
        console.log(`총 프록시: ${stats.total}개`);
        console.log(`  - 가상: ${stats.virtual_count}개`);
        console.log(`  - 실제: ${stats.real_count}개`);
        console.log(`포트 범위: ${stats.min_port} ~ ${stats.max_port}`);
        
        // 샘플 출력
        const sampleResult = await pool.query(`
            SELECT server_ip, port, external_ip
            FROM v1_hub_proxies
            WHERE port >= 20000
            ORDER BY port
            LIMIT 5
        `);
        
        console.log('\n📋 샘플 가상 프록시:');
        console.log('─'.repeat(40));
        sampleResult.rows.forEach(proxy => {
            console.log(`  ${proxy.server_ip}:${proxy.port} → ${proxy.external_ip}`);
        });
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
    
    console.log('\n✨ 가상 프록시 환경 준비 완료!');
    console.log('═'.repeat(60));
}

// 명령행 인자 처리
const args = process.argv.slice(2);
let count = 500;
let startPort = 20000;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' || args[i] === '-c') {
        count = parseInt(args[i + 1]) || 500;
    }
    if (args[i] === '--port' || args[i] === '-p') {
        startPort = parseInt(args[i + 1]) || 20000;
    }
    if (args[i] === '--help' || args[i] === '-h') {
        console.log('사용법: node create-virtual-proxies.js [옵션]');
        console.log('\n옵션:');
        console.log('  -c, --count <n>    생성할 가상 프록시 수 (기본값: 500)');
        console.log('  -p, --port <n>     시작 포트 번호 (기본값: 20000)');
        console.log('  -h, --help         도움말 표시');
        console.log('\n예제:');
        console.log('  node create-virtual-proxies.js                # 500개 생성');
        console.log('  node create-virtual-proxies.js -c 1000        # 1000개 생성');
        console.log('  node create-virtual-proxies.js -c 300 -p 30000 # 300개, 포트 30000부터');
        process.exit(0);
    }
}

// 실행
if (require.main === module) {
    createVirtualProxies(count, startPort)
        .catch(console.error)
        .then(() => process.exit(0));
}

module.exports = { createVirtualProxies };