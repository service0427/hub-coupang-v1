// 프록시 강제 토글 서비스
// 30분 이상 토글이 안 된 프록시를 강제로 토글

const axios = require('axios');
const { getPool } = require('../db/pool');

class ProxyForceToggle {
    constructor() {
        this.PROXY_SERVER = 'http://112.161.54.7:8080';
        this.checkInterval = null;
        this.CHECK_INTERVAL_MS = 60000; // 1분마다 체크
        this.FORCE_TOGGLE_AFTER_MS = 30 * 60 * 1000; // 30분
    }
    
    // 서비스 시작
    start() {
        if (this.checkInterval) {
            return;
        }
        
        console.log('🔧 프록시 강제 토글 서비스 시작');
        this.checkInterval = setInterval(() => {
            this.checkStuckProxies();
        }, this.CHECK_INTERVAL_MS);
        
        // 즉시 한 번 실행
        this.checkStuckProxies();
    }
    
    // 서비스 중지
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('🔧 프록시 강제 토글 서비스 중지');
        }
    }
    
    // 막힌 프록시 체크 및 강제 토글
    async checkStuckProxies() {
        const pool = getPool();
        
        try {
            // 30분 이상 토글 안 된 프록시 찾기
            const result = await pool.query(`
                SELECT 
                    id,
                    server_ip,
                    port,
                    use_count,
                    last_toggle_at,
                    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_toggle_at)) * 1000 as ms_since_toggle
                FROM v1_hub_proxies
                WHERE 
                    status = 'active'
                    AND server_ip = '112.161.54.7'
                    AND use_count >= 20
                    AND (
                        last_toggle_at IS NULL 
                        OR last_toggle_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
                    )
                ORDER BY last_toggle_at ASC NULLS FIRST
                LIMIT 5
            `);
            
            if (result.rows.length === 0) {
                return;
            }
            
            console.log(`⚠️ ${result.rows.length}개 프록시가 30분 이상 토글되지 않음`);
            
            for (const proxy of result.rows) {
                await this.forceToggleProxy(proxy);
                // 각 토글 사이 5초 대기
                await this.delay(5000);
            }
            
        } catch (error) {
            console.error('❌ 강제 토글 체크 오류:', error.message);
        }
    }
    
    // 개별 프록시 강제 토글
    async forceToggleProxy(proxy) {
        const subnet = proxy.port - 10000;
        console.log(`🔧 강제 토글 시도: ${proxy.server_ip}:${proxy.port} (서브넷: ${subnet})`);
        console.log(`   마지막 토글: ${proxy.last_toggle_at || 'Never'}`);
        console.log(`   사용 횟수: ${proxy.use_count}/20`);
        
        try {
            // 강제 토글 API 호출
            const response = await axios.get(
                `${this.PROXY_SERVER}/toggle/${subnet}/force`,
                { timeout: 35000 } // 강제 토글은 시간이 더 걸림
            );
            
            if (response.data.success !== false) {
                // 성공 또는 부분 성공
                console.log(`✅ 강제 토글 완료: 포트 ${proxy.port}`);
                
                // DB 업데이트
                const pool = getPool();
                await pool.query(`
                    UPDATE v1_hub_proxies
                    SET 
                        use_count = 0,
                        last_toggle_at = CURRENT_TIMESTAMP,
                        external_ip = $1
                    WHERE id = $2
                `, [response.data.new_ip || null, proxy.id]);
                
                // IP 매핑 업데이트
                if (response.data.new_ip) {
                    await pool.query(`
                        UPDATE v1_hub_proxy_ip_mapping
                        SET 
                            current_ip = $1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE proxy_id = $2
                    `, [response.data.new_ip, proxy.id]);
                }
                
            } else {
                console.log(`⚠️ 강제 토글 실패: ${response.data.error}`);
                
                // 글로벌 락 해제 시도
                if (response.data.was_old_toggle) {
                    console.log('   오래된 토글 프로세스 정리됨');
                }
            }
            
        } catch (error) {
            console.error(`❌ 강제 토글 오류 (포트 ${proxy.port}):`, error.message);
            
            // 타임아웃 오류인 경우
            if (error.code === 'ECONNABORTED') {
                console.log('   타임아웃 - 프록시 서버가 응답하지 않음');
            }
        }
    }
    
    // 지연 함수
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // 수동 강제 토글 (특정 프록시)
    async manualForceToggle(port) {
        const pool = getPool();
        
        try {
            const result = await pool.query(`
                SELECT * FROM v1_hub_proxies
                WHERE port = $1 AND server_ip = '112.161.54.7'
                LIMIT 1
            `, [port]);
            
            if (result.rows.length === 0) {
                console.log(`❌ 포트 ${port} 프록시를 찾을 수 없음`);
                return false;
            }
            
            await this.forceToggleProxy(result.rows[0]);
            return true;
            
        } catch (error) {
            console.error('❌ 수동 강제 토글 오류:', error.message);
            return false;
        }
    }
}

// 싱글톤 인스턴스
let instance = null;

function getProxyForceToggle() {
    if (!instance) {
        instance = new ProxyForceToggle();
    }
    return instance;
}

module.exports = {
    ProxyForceToggle,
    getProxyForceToggle
};