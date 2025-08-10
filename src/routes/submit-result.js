const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');
const { getToggleQueue } = require('../services/toggle-queue');

// POST /api/submit-result - 작업 결과 제출
router.post('/', async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    
    const {
        allocation_key,
        execution,
        applied_settings,
        result,
        products = [],
        performance = {},
        block_info = null
    } = req.body;
    
    try {
        await client.query('BEGIN');
        
        // 1. allocation 확인
        const allocationResult = await client.query(`
            SELECT * FROM v1_hub_work_allocations
            WHERE allocation_key = $1
            FOR UPDATE
        `, [allocation_key]);
        
        if (allocationResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'INVALID_ALLOCATION_KEY',
                message: '잘못된 할당 키입니다'
            });
        }
        
        const allocation = allocationResult.rows[0];
        
        // 이미 완료된 할당인지 체크
        if (allocation.status === 'completed') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'DUPLICATE_SUBMISSION',
                message: '이미 제출된 결과입니다'
            });
        }
        
        // 2. work_results 저장 (applied_settings를 JSONB로)
        const appliedSettingsJson = applied_settings ? {
            cart_click_enabled: applied_settings.cart_click_enabled || false,
            block_settings: {
                block_mercury: applied_settings.block_mercury || false,
                block_image_cdn: applied_settings.block_image_cdn || false,
                block_img1a_cdn: applied_settings.block_img1a_cdn || false,
                block_thumbnail_cdn: applied_settings.block_thumbnail_cdn || false
            }
        } : {
            cart_click_enabled: false,
            block_settings: {
                block_mercury: false,
                block_image_cdn: false,
                block_img1a_cdn: false,
                block_thumbnail_cdn: false
            }
        };
        
        const resultInsert = await client.query(`
            INSERT INTO v1_hub_work_results (
                allocation_id,
                started_at, completed_at, execution_time_ms,
                client_ip, instance_number, user_folder_number,
                applied_cart_click, applied_settings,
                status, status_code, current_page,
                is_blocked, block_type, block_details,
                page_load_time_ms, dom_ready_time_ms, 
                first_product_time_ms, total_requests, blocked_requests
            ) VALUES (
                $1,
                $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                $10, $11, $12,
                $13, $14, $15,
                $16, $17, $18, $19, $20
            ) RETURNING id
        `, [
            allocation.id,
            execution.started_at, execution.completed_at, execution.execution_time_ms,
            allocation.client_ip, execution.instance_number, execution.user_folder,
            appliedSettingsJson.cart_click_enabled, JSON.stringify(appliedSettingsJson),
            result.status, result.status_code, result.current_page,
            result.status === 'blocked', block_info?.block_type, block_info ? JSON.stringify(block_info) : null,
            performance.page_load_time_ms, performance.dom_ready_time_ms,
            performance.first_product_time_ms, performance.total_requests, performance.blocked_requests
        ]);
        
        const resultId = resultInsert.rows[0].id;
        
        // 3. product_results 저장
        if (products.length > 0) {
            const productValues = products.map(p => 
                `(${resultId}, ${p.product_id}, '${p.product_name.replace(/'/g, "''")}', ${p.rating || 'NULL'}, ${p.review_count || 'NULL'})`
            ).join(',');
            
            await client.query(`
                INSERT INTO v1_hub_product_results (result_id, product_id, product_name, rating, review_count)
                VALUES ${productValues}
            `);
        }
        
        // 4. allocation 상태 업데이트
        await client.query(`
            UPDATE v1_hub_work_allocations
            SET status = 'completed',
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [allocation.id]);
        
        // 5. daily_work_tracking 업데이트
        if (result.status === 'success') {
            await client.query(`
                UPDATE v1_hub_daily_work_tracking
                SET completed_count = completed_count + 1
                WHERE work_slot_id = $1 AND work_date = CURRENT_DATE
            `, [allocation.work_slot_id]);
        } else {
            await client.query(`
                UPDATE v1_hub_daily_work_tracking
                SET failed_count = failed_count + 1
                WHERE work_slot_id = $1 AND work_date = CURRENT_DATE
            `, [allocation.work_slot_id]);
        }
        
        // 6. client_activity_logs 기록
        await client.query(`
            INSERT INTO v1_hub_client_activity_logs (
                client_ip, instance_number, user_folder_number,
                allocation_id, work_slot_id, status, execution_time_ms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            allocation.client_ip, execution.instance_number, execution.user_folder,
            allocation.id, allocation.work_slot_id, result.status, execution.execution_time_ms
        ]);
        
        // 7. 프록시 사용 횟수 체크 및 토글 요청
        const proxyResult = await client.query(`
            SELECT * FROM v1_hub_proxies WHERE id = $1
        `, [allocation.proxy_id]);
        
        if (proxyResult.rows.length > 0) {
            const proxy = proxyResult.rows[0];
            console.log(`📊 프록시 ${proxy.server_ip}:${proxy.port} 사용 횟수: ${proxy.use_count}/20`);
            
            if (proxy.use_count >= 20) {
                console.log(`🔄 프록시 토글 요청: ${proxy.server_ip}:${proxy.port}`);
                
                const toggleQueue = getToggleQueue();
                // 실제 서버 정보로 토글 요청
                toggleQueue.addToQueue({
                    id: proxy.id,
                    server_ip: proxy.server_ip,
                    port: proxy.port,
                    proxy_ip: proxy.server_ip,  // 호환성
                    proxy_port: proxy.port       // 호환성
                });
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`✅ 결과 제출: ${allocation_key} | 상태: ${result.status} | 실행시간: ${execution.execution_time_ms}ms`);
        
        res.json({
            success: true,
            result_id: resultId,
            message: '결과가 저장되었습니다'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 결과 제출 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

module.exports = router;