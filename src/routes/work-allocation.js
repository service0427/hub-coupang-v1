const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');
const crypto = require('crypto');

// GET /api/allocate-work - 작업 할당 요청 (자동 폴더 할당)
router.get('/', async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    
    // 클라이언트 IP 자동 감지
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress || 
                     req.ip;
    
    // IPv6 형식 제거
    const cleanIp = clientIp.startsWith('::ffff:') ? clientIp.substring(7) : clientIp;
    
    // 인스턴스 번호 (쿼리 파라미터)
    const instanceNumber = parseInt(req.query.instance || req.query.instance_number || 1);
    
    try {
        await client.query('BEGIN');
        
        // 1. 클라이언트 정보 조회 + 락 (동시성 방지)
        const clientResult = await client.query(`
            SELECT * FROM v1_hub_clients 
            WHERE client_ip = $1 
            FOR UPDATE
        `, [cleanIp]);
        
        let clientData;
        let userFolder;
        
        if (clientResult.rows.length === 0) {
            // 신규 클라이언트 - 등록과 동시에 첫 폴더 할당
            userFolder = 1;
            const insertResult = await client.query(`
                INSERT INTO v1_hub_clients (
                    client_ip, first_seen_at, last_seen_at, 
                    last_assigned_folders, max_folders, total_requests
                ) VALUES (
                    $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    $2, 30, 1
                ) RETURNING *
            `, [cleanIp, JSON.stringify({[instanceNumber]: userFolder})]);
            clientData = insertResult.rows[0];
        } else {
            // 기존 클라이언트
            clientData = clientResult.rows[0];
            
            // 폴더 자동 할당 (롤링)
            const lastFolders = clientData.last_assigned_folders || {};
            const lastFolder = lastFolders[instanceNumber] || 0;
            const maxFolders = clientData.max_folders || 30;
            userFolder = (lastFolder % maxFolders) + 1;
            
            // 즉시 업데이트 (락 상태에서)
            lastFolders[instanceNumber] = userFolder;
            await client.query(`
                UPDATE v1_hub_clients 
                SET last_assigned_folders = $1,
                    last_seen_at = CURRENT_TIMESTAMP,
                    total_requests = total_requests + 1,
                    observed_max_instance = GREATEST(observed_max_instance, $2),
                    observed_max_user_folder = GREATEST(observed_max_user_folder, $3)
                WHERE client_ip = $4
            `, [JSON.stringify(lastFolders), instanceNumber, userFolder, cleanIp]);
        }
        
        // 2. 할당 가능한 작업 찾기 (오늘 날짜, 목표 미달성)
        const workResult = await client.query(`
            SELECT ws.*, dwt.allocated_count, dwt.completed_count
            FROM v1_hub_work_slots ws
            INNER JOIN v1_hub_daily_work_tracking dwt ON dwt.work_slot_id = ws.id
            WHERE dwt.work_date = CURRENT_DATE
            AND ws.status = 'active'
            AND ws.start_date <= CURRENT_DATE
            AND ws.end_date >= CURRENT_DATE
            AND dwt.allocated_count < ws.daily_work_count
            AND NOT EXISTS (
                SELECT 1 FROM v1_hub_work_allocations wa
                WHERE wa.work_slot_id = ws.id
                AND wa.client_ip = $1
                AND wa.reported_instance = $2
                AND wa.reported_user_folder = $3
                AND wa.work_date = CURRENT_DATE
                AND wa.status IN ('allocated', 'completed')
            )
            ORDER BY 
                (dwt.allocated_count::float / NULLIF(ws.daily_work_count, 0)) ASC,
                CASE 
                    WHEN ws.extra_config->>'priority' ~ '^[0-9]+$' 
                    THEN (ws.extra_config->>'priority')::int 
                    ELSE 5 
                END DESC,
                RANDOM()
            LIMIT 1
            FOR UPDATE OF ws
        `, [cleanIp, instanceNumber, userFolder]);
        
        if (workResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'NO_WORK_AVAILABLE',
                message: '현재 할당 가능한 작업이 없습니다',
                instance: instanceNumber,
                folder: userFolder
            });
        }
        
        const workSlot = workResult.rows[0];
        
        // 3. 사용 가능한 프록시 찾기
        const proxyResult = await client.query(`
            SELECT * FROM v1_hub_proxies
            WHERE status = 'active'
            AND use_count < 20
            ORDER BY use_count ASC, last_used_at ASC NULLS FIRST
            LIMIT 1
            FOR UPDATE
        `);
        
        if (proxyResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(503).json({
                success: false,
                error: 'NO_PROXY_AVAILABLE',
                message: '사용 가능한 프록시가 없습니다'
            });
        }
        
        const proxy = proxyResult.rows[0];
        
        // 4. 할당 키 생성
        const allocationKey = `WA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(6).toString('hex')}`;
        
        // 5. 작업 스냅샷 생성
        const workSlotSnapshot = {
            keyword: workSlot.keyword,
            code: workSlot.code,
            cart_click_enabled: workSlot.cart_click_enabled,
            extra_config: workSlot.extra_config
        };
        
        // 6. 할당 레코드 생성
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
            cleanIp, instanceNumber, userFolder,
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
        
        console.log(`✅ 작업 할당: ${allocationKey} | Instance: ${instanceNumber} | Folder: ${userFolder} | 키워드: ${workSlot.keyword} | 프록시: ${proxy.server_ip}:${proxy.port}`);
        
        // 응답
        res.json({
            success: true,
            allocation_key: allocationKey,
            instance: instanceNumber,
            folder: userFolder,  // 서버가 자동 할당한 폴더
            work: {
                keyword: workSlot.keyword,
                code: workSlot.code
            },
            proxy: {
                url: `socks5://${proxy.server_ip}:${proxy.port}`,
                external_ip: proxy.external_ip,
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

// POST /api/allocate-work - 기존 POST 방식도 지원 (하위 호환성)
router.post('/', async (req, res) => {
    // GET 방식으로 리다이렉트
    const instance = req.body.instance_number || 1;
    req.query = { instance };
    return router.handle(req, res);
});

// GET /api/allocate-work/:allocation_key - 할당 상태 조회
router.get('/:allocation_key', async (req, res) => {
    const pool = getPool();
    const { allocation_key } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                wa.*,
                ws.keyword, ws.code,
                p.server_ip, p.port, p.external_ip
            FROM v1_hub_work_allocations wa
            JOIN v1_hub_work_slots ws ON ws.id = wa.work_slot_id
            JOIN v1_hub_proxies p ON p.id = wa.proxy_id
            WHERE wa.allocation_key = $1
        `, [allocation_key]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'ALLOCATION_NOT_FOUND'
            });
        }
        
        const allocation = result.rows[0];
        
        res.json({
            success: true,
            allocation: {
                key: allocation.allocation_key,
                status: allocation.status,
                instance: allocation.reported_instance,
                folder: allocation.reported_user_folder,
                allocated_at: allocation.allocated_at,
                expires_at: allocation.expires_at,
                completed_at: allocation.completed_at,
                work: {
                    keyword: allocation.keyword,
                    code: allocation.code
                },
                proxy: {
                    url: `socks5://${allocation.server_ip}:${allocation.port}`,
                    external_ip: allocation.external_ip
                }
            }
        });
        
    } catch (error) {
        console.error('할당 조회 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;