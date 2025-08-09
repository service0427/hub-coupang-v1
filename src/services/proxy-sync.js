// 프록시 서버 동기화 서비스
const axios = require('axios');
const { getPool } = require('../db/pool');

class ProxySync {
    constructor() {
        this.PROXY_SERVER = 'http://112.161.54.7:8080';
        this.syncInterval = null;
    }
    
    // 프록시 서버에서 활성 프록시 목록 가져오기
    async fetchActiveProxies() {
        try {
            const response = await axios.get(`${this.PROXY_SERVER}/status`, {
                timeout: 5000
            });
            
            if (response.data && response.data.available_proxies) {
                return response.data.available_proxies.map(proxy => {
                    // socks5://112.161.54.7:10011 형식에서 포트 추출
                    const urlParts = proxy.proxy_url.split(':');
                    const port = parseInt(urlParts[urlParts.length - 1]);
                    const serverIp = urlParts[1].replace('//', '');
                    
                    return {
                        server_ip: serverIp,
                        port: port,
                        external_ip: proxy.external_ip,
                        last_toggle: proxy.last_toggle,
                        can_toggle: proxy.can_toggle
                    };
                });
            }
            
            return [];
        } catch (error) {
            console.error('❌ 프록시 서버 상태 조회 실패:', error.message);
            return [];
        }
    }
    
    // DB와 프록시 서버 동기화
    async syncProxies() {
        const pool = getPool();
        const client = await pool.connect();
        
        try {
            console.log('🔄 프록시 동기화 시작...');
            
            // 1. 실제 프록시 서버에서 목록 가져오기
            const activeProxies = await this.fetchActiveProxies();
            
            if (activeProxies.length === 0) {
                console.log('⚠️ 활성 프록시가 없습니다');
                return;
            }
            
            console.log(`📋 활성 프록시 ${activeProxies.length}개 발견`);
            
            await client.query('BEGIN');
            
            // 2. 실제 프록시만 비활성화 (가상 프록시는 유지)
            await client.query(`
                UPDATE v1_hub_proxies 
                SET status = 'inactive',
                    updated_at = CURRENT_TIMESTAMP
                WHERE server_ip = '112.161.54.7'
            `);
            
            // 3. 활성 프록시 업데이트 또는 삽입
            for (const proxy of activeProxies) {
                // 프록시 존재 확인
                const existingResult = await client.query(`
                    SELECT id, use_count FROM v1_hub_proxies 
                    WHERE server_ip = $1 AND port = $2
                `, [proxy.server_ip, proxy.port]);
                
                if (existingResult.rows.length > 0) {
                    // 기존 프록시 업데이트
                    const existing = existingResult.rows[0];
                    await client.query(`
                        UPDATE v1_hub_proxies 
                        SET external_ip = $1,
                            status = 'active',
                            last_toggle_at = $2,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $3
                    `, [proxy.external_ip, proxy.last_toggle, existing.id]);
                    
                    // IP 매핑 업데이트
                    await client.query(`
                        INSERT INTO v1_hub_proxy_ip_mapping (proxy_id, proxy_number, current_ip)
                        VALUES ($1, 1, $2)
                        ON CONFLICT (proxy_id, proxy_number) 
                        DO UPDATE SET 
                            current_ip = $2,
                            updated_at = CURRENT_TIMESTAMP
                    `, [existing.id, proxy.external_ip]);
                    
                    console.log(`✅ 프록시 업데이트: ${proxy.server_ip}:${proxy.port} → ${proxy.external_ip}`);
                    
                } else {
                    // 새 프록시 삽입
                    const insertResult = await client.query(`
                        INSERT INTO v1_hub_proxies 
                        (server_ip, port, external_ip, use_count, status, last_toggle_at)
                        VALUES ($1, $2, $3, 0, 'active', $4)
                        RETURNING id
                    `, [proxy.server_ip, proxy.port, proxy.external_ip, proxy.last_toggle]);
                    
                    const newId = insertResult.rows[0].id;
                    
                    // IP 매핑 생성
                    await client.query(`
                        INSERT INTO v1_hub_proxy_ip_mapping (proxy_id, proxy_number, current_ip)
                        VALUES ($1, 1, $2)
                    `, [newId, proxy.external_ip]);
                    
                    console.log(`✅ 새 프록시 추가: ${proxy.server_ip}:${proxy.port} → ${proxy.external_ip}`);
                }
            }
            
            await client.query('COMMIT');
            
            // 4. 동기화 결과 확인
            const countResult = await pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE status = 'active') as active,
                    COUNT(*) FILTER (WHERE status = 'inactive') as inactive,
                    COUNT(*) as total
                FROM v1_hub_proxies
            `);
            
            const counts = countResult.rows[0];
            console.log(`✅ 동기화 완료: 활성 ${counts.active}개, 비활성 ${counts.inactive}개, 총 ${counts.total}개`);
            
            return {
                success: true,
                active: parseInt(counts.active),
                inactive: parseInt(counts.inactive),
                total: parseInt(counts.total)
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ 프록시 동기화 실패:', error.message);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }
    
    // 주기적 동기화 시작
    startAutoSync(intervalMs = 60000) {
        if (this.syncInterval) {
            console.log('⚠️ 자동 동기화가 이미 실행 중입니다');
            return;
        }
        
        console.log(`🔄 프록시 자동 동기화 시작 (간격: ${intervalMs / 1000}초)`);
        
        // 즉시 한 번 실행
        this.syncProxies();
        
        // 주기적 실행
        this.syncInterval = setInterval(() => {
            this.syncProxies();
        }, intervalMs);
    }
    
    // 주기적 동기화 중지
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('🛑 프록시 자동 동기화 중지');
        }
    }
    
    // 특정 프록시의 현재 IP 확인
    async checkProxyIP(serverIp, port) {
        try {
            const response = await axios.get(`${this.PROXY_SERVER}/status`, {
                timeout: 5000
            });
            
            if (response.data && response.data.available_proxies) {
                const proxy = response.data.available_proxies.find(p => {
                    const urlParts = p.proxy_url.split(':');
                    const pPort = parseInt(urlParts[urlParts.length - 1]);
                    return pPort === port;
                });
                
                if (proxy) {
                    return proxy.external_ip;
                }
            }
            
            return null;
        } catch (error) {
            console.error(`❌ IP 확인 실패 (${serverIp}:${port}):`, error.message);
            return null;
        }
    }
}

// 싱글톤 인스턴스
let instance = null;

function getProxySync() {
    if (!instance) {
        instance = new ProxySync();
    }
    return instance;
}

module.exports = {
    ProxySync,
    getProxySync
};