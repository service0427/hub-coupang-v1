const axios = require('axios');
const { getPool } = require('../db/pool');

class ToggleQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.globalCooldownTime = 0;
        // 환경 변수로 쿨다운 설정 가능 (기본값: 31초)
        this.COOLDOWN_MS = parseInt(process.env.TOGGLE_COOLDOWN_MS || '31000');
        this.PROXY_SERVER = 'http://112.161.54.7:8080';
        this.stats = {
            totalRequests: 0,
            successCount: 0,
            failCount: 0,
            cooldownWaits: 0,
            retryCount: 0
        };
        
        console.log(`🔧 토글 쿨다운 설정: ${this.COOLDOWN_MS}ms (${this.COOLDOWN_MS/1000}초)`);
    }

    // 큐에 토글 요청 추가
    addToQueue(proxyInfo) {
        // 중복 방지
        const exists = this.queue.find(item => item.port === proxyInfo.port);
        if (!exists) {
            this.queue.push({
                ...proxyInfo,
                addedAt: Date.now(),
                retryCount: 0,
                maxRetries: 3
            });
            console.log(`📥 토글 큐에 추가: 포트 ${proxyInfo.port} (큐 크기: ${this.queue.length})`);
        }
        
        // 처리 시작
        if (!this.processing) {
            this.processQueue();
        }
    }

    // 큐 처리
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0]; // 첫 번째 아이템 가져오기

            // 글로벌 쿨다운 체크
            const now = Date.now();
            if (this.globalCooldownTime > now) {
                const waitTime = this.globalCooldownTime - now;
                console.log(`⏳ 글로벌 쿨다운 대기: ${Math.ceil(waitTime / 1000)}초`);
                this.stats.cooldownWaits++;
                await this.delay(waitTime);
            }

            // 토글 시도
            const result = await this.attemptToggle(item);

            if (result.success) {
                // 성공시 큐에서 제거
                this.queue.shift();
                this.stats.successCount++;
                
                // 글로벌 쿨다운 설정
                this.globalCooldownTime = Date.now() + this.COOLDOWN_MS;
                
                // DB 업데이트
                await this.updateDatabase(item, result);
                
                // 다음 토글까지 대기
                await this.delay(this.COOLDOWN_MS);
                
            } else if (result.cooldown) {
                // 쿨다운인 경우 대기
                this.globalCooldownTime = Date.now() + (result.cooldown * 1000);
                console.log(`⏳ 쿨다운으로 인한 대기: ${result.cooldown}초`);
                await this.delay(result.cooldown * 1000);
                
            } else {
                // skipRetry가 true면 재시도하지 않고 즉시 제거
                if (result.skipRetry) {
                    console.log(`🚫 포트 ${item.port} 토글 건너뜀 (잠김 상태)`);
                    this.queue.shift(); // 큐에서 제거
                    this.stats.failCount++;
                } else {
                    // 실패시 재시도 처리
                    item.retryCount++;
                    
                    if (item.retryCount >= item.maxRetries) {
                        console.log(`❌ 포트 ${item.port} 토글 최종 실패 (재시도 ${item.retryCount}회)`);
                        this.queue.shift(); // 큐에서 제거
                        this.stats.failCount++;
                    } else {
                        console.log(`⚠️ 포트 ${item.port} 토글 실패, 재시도 예정 (${item.retryCount}/${item.maxRetries})`);
                        this.stats.retryCount++;
                        
                        // 큐 뒤로 이동
                        this.queue.push(this.queue.shift());
                        
                        // 재시도 전 대기
                        await this.delay(5000);
                    }
                }
            }
        }

        this.processing = false;
        console.log('✅ 토글 큐 처리 완료');
    }

    // 토글 시도
    async attemptToggle(item) {
        this.stats.totalRequests++;
        
        try {
            // 가상 프록시 체크 (포트 20000 이상 또는 10.x.x.x IP)
            const isVirtual = item.port >= 20000 || item.server_ip.startsWith('10.');
            
            if (isVirtual) {
                // 가상 프록시는 실제 토글 없이 시뮬레이션
                console.log(`🎮 가상 토글: ${item.server_ip}:${item.port} (ID: ${item.id})`);
                
                // 랜덤 처리 시간 (100-500ms)
                const processingMs = Math.floor(Math.random() * 400) + 100;
                await this.delay(processingMs);
                
                // 새로운 가상 IP 생성
                const newIp = `203.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
                
                console.log(`✅ 가상 토글 성공: ${item.external_ip || 'unknown'} → ${newIp}`);
                console.log(`   처리 시간: ${processingMs}ms`);
                
                return {
                    success: true,
                    oldIp: item.external_ip || 'unknown',
                    newIp: newIp,
                    processingMs: processingMs,
                    isVirtual: true
                };
            }
            
            // 실제 프록시 처리
            // 프록시 서버 상태 확인
            const statusResponse = await axios.get(`${this.PROXY_SERVER}/status`, {
                timeout: 5000
            });

            if (statusResponse.data.global_cooldown_remaining > 0) {
                return { 
                    success: false, 
                    cooldown: statusResponse.data.global_cooldown_remaining 
                };
            }

            // 토글 실행 - 서브넷 번호 사용 (포트 - 10000)
            const subnet = item.port - 10000;
            console.log(`🔄 토글 시도: ${item.server_ip}:${item.port} (서브넷: ${subnet}, ID: ${item.id})`);
            const toggleResponse = await axios.get(
                `${this.PROXY_SERVER}/toggle/${subnet}`,
                { timeout: 15000 }
            );

            if (toggleResponse.data.success) {
                console.log(`✅ 토글 성공: ${toggleResponse.data.old_ip} → ${toggleResponse.data.new_ip}`);
                console.log(`   처리 시간: ${toggleResponse.data.processing_ms}ms`);
                return {
                    success: true,
                    oldIp: toggleResponse.data.old_ip,
                    newIp: toggleResponse.data.new_ip,
                    processingMs: toggleResponse.data.processing_ms
                };
            } else if (toggleResponse.data.error_code === 'GLOBAL_COOLDOWN') {
                return {
                    success: false,
                    cooldown: toggleResponse.data.remaining_seconds
                };
            } else {
                console.log(`❌ 토글 실패: ${toggleResponse.data.error}`);
                return { success: false, error: toggleResponse.data.error };
            }

        } catch (error) {
            console.error(`❌ 토글 오류 (포트 ${item.port}):`, error.message);
            
            // 423 에러(프록시 잠김)인 경우 특별 처리
            if (error.response && error.response.status === 423) {
                console.log(`🔒 포트 ${item.port}는 다른 프로세스가 처리 중입니다. 큐에서 제거합니다.`);
                return { success: false, error: 'LOCKED', skipRetry: true };
            }
            
            return { success: false, error: error.message };
        }
    }

    // DB 업데이트
    async updateDatabase(item, result) {
        const pool = getPool();
        
        try {
            // 프록시 정보 업데이트
            await pool.query(`
                UPDATE v1_hub_proxies 
                SET 
                    use_count = 0,
                    external_ip = $1,
                    last_toggle_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [result.newIp, item.id]);
            
            // IP 매핑도 업데이트
            await pool.query(`
                UPDATE v1_hub_proxy_ip_mapping
                SET current_ip = $1,
                    last_toggle = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE proxy_id = $2
            `, [result.newIp, item.id]);

            console.log(`📝 DB 업데이트 완료 (ID: ${item.id}, 새 IP: ${result.newIp})`);

        } catch (error) {
            console.error('❌ DB 업데이트 실패:', error.message);
        }
    }

    // 유틸리티: 딜레이
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 큐 상태 조회
    getStatus() {
        return {
            queueSize: this.queue.length,
            processing: this.processing,
            globalCooldownRemaining: Math.max(0, Math.ceil((this.globalCooldownTime - Date.now()) / 1000)),
            stats: this.stats,
            queue: this.queue.map(item => ({
                port: item.port,
                id: item.id,
                retryCount: item.retryCount,
                waitingTime: Math.ceil((Date.now() - item.addedAt) / 1000)
            }))
        };
    }

    // 큐 클리어
    clearQueue() {
        const clearedCount = this.queue.length;
        this.queue = [];
        console.log(`🗑️ 토글 큐 클리어 (${clearedCount}개 제거)`);
        return clearedCount;
    }
}

// 싱글톤 인스턴스
let queueInstance = null;

function getToggleQueue() {
    if (!queueInstance) {
        queueInstance = new ToggleQueue();
    }
    return queueInstance;
}

module.exports = {
    ToggleQueue,
    getToggleQueue
};