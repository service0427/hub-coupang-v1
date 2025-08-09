const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');

// POST /api/work-slots - 작업 슬롯 생성
router.post('/', async (req, res) => {
    const pool = getPool();
    const {
        keyword,
        code,
        start_date,
        end_date,
        daily_work_count = 100,
        cart_click_enabled = false,
        block_mercury = false,
        block_image_cdn = false,
        block_img1a_cdn = false,
        block_thumbnail_cdn = false
    } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO v1_hub_work_slots 
            (keyword, code, start_date, end_date, daily_work_count,
             cart_click_enabled, block_mercury, block_image_cdn, 
             block_img1a_cdn, block_thumbnail_cdn)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `, [keyword, code, start_date, end_date, daily_work_count,
            cart_click_enabled, block_mercury, block_image_cdn,
            block_img1a_cdn, block_thumbnail_cdn]);
        
        console.log(`✅ 작업 슬롯 생성: ID ${result.rows[0].id}, 키워드: ${keyword}`);
        
        res.json({
            success: true,
            slot_id: result.rows[0].id,
            message: '작업 슬롯이 생성되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 작업 슬롯 생성 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/work-slots - 작업 슬롯 조회
router.get('/', async (req, res) => {
    const pool = getPool();
    
    try {
        const result = await pool.query(`
            SELECT 
                ws.*,
                dwt.target_count,
                dwt.completed_count,
                dwt.failed_count,
                CASE 
                    WHEN dwt.target_count > 0 
                    THEN ROUND(dwt.completed_count::numeric / dwt.target_count * 100, 2)
                    ELSE 0 
                END as completion_rate,
                CASE 
                    WHEN CURRENT_DATE < ws.start_date THEN 'pending'
                    WHEN CURRENT_DATE > ws.end_date THEN 'expired'
                    WHEN NOT ws.is_active THEN 'paused'
                    ELSE 'active'
                END as status
            FROM v1_hub_work_slots ws
            LEFT JOIN v1_hub_daily_work_tracking dwt 
                ON ws.id = dwt.work_slot_id 
                AND dwt.work_date = CURRENT_DATE
            ORDER BY ws.id DESC
        `);
        
        res.json({
            success: true,
            slots: result.rows
        });
        
    } catch (error) {
        console.error('❌ 작업 슬롯 조회 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PATCH /api/work-slots/:id/settings - 블록 설정 수정
router.patch('/:id/settings', async (req, res) => {
    const pool = getPool();
    const { id } = req.params;
    const settings = req.body;
    
    try {
        const setClauses = [];
        const values = [];
        let paramCount = 1;
        
        const allowedSettings = [
            'cart_click_enabled',
            'block_mercury',
            'block_image_cdn',
            'block_img1a_cdn',
            'block_thumbnail_cdn'
        ];
        
        for (const [key, value] of Object.entries(settings)) {
            if (allowedSettings.includes(key)) {
                setClauses.push(`${key} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }
        }
        
        if (setClauses.length === 0) {
            return res.status(400).json({
                success: false,
                error: '유효한 설정이 없습니다'
            });
        }
        
        values.push(id);
        
        await pool.query(`
            UPDATE v1_hub_work_slots 
            SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramCount}
        `, values);
        
        console.log(`✅ 슬롯 ${id} 설정 업데이트:`, settings);
        
        res.json({
            success: true,
            message: '설정이 업데이트되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 설정 업데이트 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/work-slots/init-daily - 일별 추적 초기화 (수동 실행용)
router.post('/init-daily', async (req, res) => {
    const pool = getPool();
    
    try {
        await pool.query('SELECT init_daily_work_tracking()');
        
        const result = await pool.query(`
            SELECT COUNT(*) as initialized
            FROM v1_hub_daily_work_tracking
            WHERE work_date = CURRENT_DATE
        `);
        
        console.log(`✅ 일별 추적 초기화: ${result.rows[0].initialized}개 슬롯`);
        
        res.json({
            success: true,
            initialized: parseInt(result.rows[0].initialized),
            message: '일별 추적이 초기화되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 일별 추적 초기화 오류:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;