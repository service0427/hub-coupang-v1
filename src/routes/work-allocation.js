const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');
const crypto = require('crypto');

// GET /api/allocate-work - 작업 할당 요청
router.get('/', async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    
    // 클라이언트 정보
    const clientIp = req.headers['x-client-ip'] || req.ip;
    const instanceNumber = parseInt(req.headers['x-instance-number']) || 1;
    const userFolder = parseInt(req.headers['x-user-folder']) || 1;
    
    try {
        await client.query('BEGIN');
        
        // 1. 클라이언트 자동 등록/업데이트
        await client.query(`
            INSERT INTO v1_hub_clients (client_ip, last_seen_at, total_requests)
            VALUES ($1, CURRENT_TIMESTAMP, 1)
            ON CONFLICT (client_ip) 
            DO UPDATE SET 
                last_seen_at = CURRENT_TIMESTAMP,
                total_requests = v1_hub_clients.total_requests + 1,
                observed_max_instance = GREATEST(v1_hub_clients.observed_max_instance, $2),
                observed_max_user_folder = GREATEST(v1_hub_clients.observed_max_user_folder, $3)
        `, [clientIp, instanceNumber, userFolder]);
        
        // 2. 활성 work_slot 중 할당 가능한 것 찾기
        const workSlotResult = await client.query(`
            SELECT ws.*, dwt.allocated_count, dwt.target_count
            FROM v1_hub_work_slots ws
            JOIN v1_hub_daily_work_tracking dwt 
                ON ws.id = dwt.work_slot_id 
                AND dwt.work_date = CURRENT_DATE
            WHERE CURRENT_DATE BETWEEN ws.start_date AND ws.end_date
                AND ws.is_active = true
                AND dwt.allocated_count < dwt.target_count
            ORDER BY 
                (dwt.allocated_count::float / dwt.target_count) ASC,
                ws.id ASC
            LIMIT 1
            FOR UPDATE
        `);
        
        if (workSlotResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'NO_WORK_AVAILABLE',
                message: '현재 할당 가능한 작업이 없습니다'
            });
        }
        
        const workSlot = workSlotResult.rows[0];
        
        // 3. 사용 가능한 프록시 찾기 (use_count < 20, 활성 상태)
        const proxyResult = await client.query(`
            SELECT p.*, pim.current_ip as external_ip
            FROM v1_hub_proxies p
            JOIN v1_hub_proxy_ip_mapping pim ON p.id = pim.proxy_id
            WHERE p.use_count < 20
                AND p.status = 'active'
            ORDER BY p.use_count ASC, p.id ASC
            LIMIT 1
            FOR UPDATE
        `);
        
        if (proxyResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(503).json({
                success: false,
                error: 'PROXY_NOT_AVAILABLE',
                message: '사용 가능한 프록시가 없습니다'
            });
        }
        
        const proxy = proxyResult.rows[0];
        
        // 4. allocation_key 생성
        const allocationKey = `WA-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${crypto.randomBytes(6).toString('hex')}`;
        
        // 5. work_slot의 현재 상태를 스냅샷으로 저장
        const workSlotSnapshot = {
            id: workSlot.id,
            keyword: workSlot.keyword,
            code: workSlot.code,
            start_date: workSlot.start_date,
            end_date: workSlot.end_date,
            extra_config: workSlot.extra_config || {},
            cart_click_enabled: workSlot.cart_click_enabled,
            is_active: workSlot.is_active,
            snapshot_at: new Date().toISOString()
        };
        
        // 6. 작업 할당 생성 (120초 타임아웃 설정, 스냅샷 포함)
        const allocationResult = await client.query(`
            INSERT INTO v1_hub_work_allocations (
                work_slot_id, work_date, proxy_id, 
                assigned_proxy_ip, assigned_proxy_port,
                client_ip, reported_instance, reported_user_folder,
                allocation_key, allocated_at, expires_at, status,
                work_slot_snapshot
            ) VALUES (
                $1, CURRENT_DATE, $2,
                $3, $4,
                $5, $6, $7,
                $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '120 seconds', 'allocated',
                $9
            ) RETURNING id, expires_at
        `, [
            workSlot.id, proxy.id,
            proxy.server_ip, proxy.port,
            clientIp, instanceNumber, userFolder,
            allocationKey,
            JSON.stringify(workSlotSnapshot)
        ]);
        
        // 7. 프록시 use_count 증가
        await client.query(`
            UPDATE v1_hub_proxies 
            SET use_count = use_count + 1,
                last_used_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [proxy.id]);
        
        // 8. daily_work_tracking allocated_count 증가
        await client.query(`
            UPDATE v1_hub_daily_work_tracking
            SET allocated_count = allocated_count + 1,
                first_allocation_at = COALESCE(first_allocation_at, CURRENT_TIMESTAMP),
                last_allocation_at = CURRENT_TIMESTAMP
            WHERE work_slot_id = $1 AND work_date = CURRENT_DATE
        `, [workSlot.id]);
        
        await client.query('COMMIT');
        
        console.log(`✅ 작업 할당: ${allocationKey} | 키워드: ${workSlot.keyword} | 프록시: ${proxy.server_ip}:${proxy.port} (${proxy.use_count + 1}/20)`);
        
        // 응답
        res.json({
            success: true,
            allocation_key: allocationKey,
            work: {
                keyword: workSlot.keyword,
                code: workSlot.code
            },
            proxy: {
                ip: proxy.server_ip,
                port: proxy.port,
                external_ip: proxy.external_ip,
                type: 'socks5',
                use_count: proxy.use_count + 1
            },
            settings: {
                cart_click_enabled: workSlot.cart_click_enabled || false,
                ...((workSlot.extra_config?.block_settings) || {
                    block_mercury: false,
                    block_image_cdn: false,
                    block_img1a_cdn: false,
                    block_thumbnail_cdn: false
                })
            },
            expires_at: allocationResult.rows[0].expires_at
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 작업 할당 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// GET /api/allocations/:allocation_key - 할당 상태 확인
router.get('/:allocation_key', async (req, res) => {
    const pool = getPool();
    const { allocation_key } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                allocation_key as key,
                status,
                allocated_at,
                expires_at,
                completed_at
            FROM v1_hub_work_allocations
            WHERE allocation_key = $1
        `, [allocation_key]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'ALLOCATION_NOT_FOUND',
                message: '할당을 찾을 수 없습니다'
            });
        }
        
        res.json({
            success: true,
            allocation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 할당 조회 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;