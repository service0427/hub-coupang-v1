// 할당 타임아웃 관리 서비스
const { getPool } = require('../db/pool');

class AllocationTimeoutManager {
    constructor() {
        this.checkInterval = null;
        this.TIMEOUT_MS = 120000; // 120초
        this.CHECK_INTERVAL_MS = 10000; // 10초마다 체크
    }
    
    // 타임아웃 체크 시작
    start() {
        if (this.checkInterval) {
            return;
        }
        
        console.log('⏰ 할당 타임아웃 매니저 시작');
        this.checkInterval = setInterval(() => {
            this.checkTimeouts();
        }, this.CHECK_INTERVAL_MS);
        
        // 즉시 한 번 실행
        this.checkTimeouts();
    }
    
    // 타임아웃 체크 중지
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('⏰ 할당 타임아웃 매니저 중지');
        }
    }
    
    // 타임아웃된 할당 체크 및 처리
    async checkTimeouts() {
        const pool = getPool();
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. 타임아웃된 할당 찾기 (allocated 상태이고 expires_at이 지난 것)
            const timeoutResult = await client.query(`
                SELECT 
                    wa.*,
                    ws.keyword,
                    p.server_ip,
                    p.port,
                    p.use_count
                FROM v1_hub_work_allocations wa
                JOIN v1_hub_work_slots ws ON wa.work_slot_id = ws.id
                LEFT JOIN v1_hub_proxies p ON wa.proxy_id = p.id
                WHERE wa.status = 'allocated'
                    AND wa.expires_at < CURRENT_TIMESTAMP
                FOR UPDATE OF wa
            `);
            
            if (timeoutResult.rows.length === 0) {
                await client.query('COMMIT');
                return;
            }
            
            console.log(`⏱️ 타임아웃된 할당 ${timeoutResult.rows.length}개 발견`);
            
            for (const allocation of timeoutResult.rows) {
                // 2. 할당 상태를 'expired'로 변경
                await client.query(`
                    UPDATE v1_hub_work_allocations
                    SET status = 'expired',
                        completed_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [allocation.id]);
                
                // 3. 프록시 use_count 감소 (사용하지 않았으므로)
                if (allocation.proxy_id) {
                    await client.query(`
                        UPDATE v1_hub_proxies
                        SET use_count = GREATEST(0, use_count - 1)
                        WHERE id = $1
                    `, [allocation.proxy_id]);
                }
                
                // 4. daily_work_tracking의 allocated_count 감소, failed_count 증가
                await client.query(`
                    UPDATE v1_hub_daily_work_tracking
                    SET allocated_count = GREATEST(0, allocated_count - 1),
                        failed_count = failed_count + 1
                    WHERE work_slot_id = $1 AND work_date = $2
                `, [allocation.work_slot_id, allocation.work_date]);
                
                // 5. 클라이언트 활동 로그 기록
                if (allocation.client_ip) {
                    await client.query(`
                        INSERT INTO v1_hub_client_activity_logs (
                            client_ip, instance_number, user_folder_number,
                            allocation_id, work_slot_id, status, execution_time_ms
                        ) VALUES ($1, $2, $3, $4, $5, 'timeout', $6)
                    `, [
                        allocation.client_ip,
                        allocation.reported_instance,
                        allocation.reported_user_folder,
                        allocation.id,
                        allocation.work_slot_id,
                        this.TIMEOUT_MS
                    ]);
                }
                
                console.log(`❌ 타임아웃 처리: ${allocation.allocation_key} | 키워드: ${allocation.keyword} | 프록시: ${allocation.server_ip}:${allocation.port}`);
            }
            
            await client.query('COMMIT');
            
            console.log(`✅ ${timeoutResult.rows.length}개 타임아웃 할당 처리 완료`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ 타임아웃 체크 오류:', error.message);
        } finally {
            client.release();
        }
    }
    
    // 특정 할당의 만료 시간 연장
    async extendAllocation(allocationKey, additionalSeconds = 60) {
        const pool = getPool();
        
        try {
            const result = await pool.query(`
                UPDATE v1_hub_work_allocations
                SET expires_at = CURRENT_TIMESTAMP + INTERVAL '${additionalSeconds} seconds'
                WHERE allocation_key = $1 
                    AND status = 'allocated'
                RETURNING expires_at
            `, [allocationKey]);
            
            if (result.rows.length > 0) {
                console.log(`⏰ 할당 시간 연장: ${allocationKey} (+${additionalSeconds}초)`);
                return result.rows[0].expires_at;
            }
            
            return null;
        } catch (error) {
            console.error('❌ 할당 연장 오류:', error.message);
            return null;
        }
    }
    
    // 통계 조회
    async getStats() {
        const pool = getPool();
        
        try {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE status = 'allocated') as active,
                    COUNT(*) FILTER (WHERE status = 'expired') as expired_total,
                    COUNT(*) FILTER (WHERE status = 'expired' AND work_date = CURRENT_DATE) as expired_today,
                    COUNT(*) FILTER (WHERE status = 'allocated' AND expires_at < CURRENT_TIMESTAMP) as pending_timeout,
                    MIN(expires_at) FILTER (WHERE status = 'allocated') as next_timeout
                FROM v1_hub_work_allocations
                WHERE work_date >= CURRENT_DATE - INTERVAL '1 day'
            `);
            
            return {
                active: parseInt(result.rows[0].active),
                expiredTotal: parseInt(result.rows[0].expired_total),
                expiredToday: parseInt(result.rows[0].expired_today),
                pendingTimeout: parseInt(result.rows[0].pending_timeout),
                nextTimeout: result.rows[0].next_timeout
            };
        } catch (error) {
            console.error('❌ 통계 조회 오류:', error.message);
            return {
                active: 0,
                expiredTotal: 0,
                expiredToday: 0,
                pendingTimeout: 0,
                nextTimeout: null
            };
        }
    }
}

// 싱글톤 인스턴스
let instance = null;

function getTimeoutManager() {
    if (!instance) {
        instance = new AllocationTimeoutManager();
    }
    return instance;
}

module.exports = {
    getTimeoutManager,
    AllocationTimeoutManager
};