const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');
const axios = require('axios');

// 프록시 서버 정보
const PROXY_SERVERS = {
    'proxy1': 'http://112.161.54.7:8080'
};

// 3중 조건 검증: 키워드 호출 가능성 체크
router.get('/keyword/check', async (req, res) => {
    const pool = getPool();
    const { ip, proxy, keyword } = req.query;
    
    if (!ip || !proxy || !keyword) {
        return res.status(400).json({
            success: false,
            error: 'ip, proxy, keyword parameters are required'
        });
    }
    
    try {
        // 1. IP 허용 확인
        const ipCheck = await pool.query(`
            SELECT COUNT(*) as count 
            FROM v1_hub_ip_keyword_restrictions 
            WHERE ip_address = $1 AND is_active = true
        `, [ip]);
        
        const ipAllowed = ipCheck.rows[0].count > 0;
        
        // 2. 프록시 활성 확인
        const proxyCheck = await pool.query(`
            SELECT COUNT(*) as count 
            FROM v1_hub_proxies 
            WHERE port = $1 AND status = 'active'
        `, [parseInt('100' + proxy)]);
        
        const proxyActive = proxyCheck.rows[0].count > 0;
        
        // 3. 키워드 할당 확인
        const keywordCheck = await pool.query(`
            SELECT ikr.*, tk.keyword as keyword_name
            FROM v1_hub_ip_keyword_restrictions ikr
            JOIN v1_hub_test_keywords tk ON ikr.keyword_id = tk.id
            WHERE ikr.ip_address = $1 
            AND ikr.proxy_number = $2 
            AND tk.keyword = $3
            AND ikr.is_active = true
        `, [ip, proxy, keyword]);
        
        const keywordAssigned = keywordCheck.rows.length > 0;
        const keywordAvailable = keywordAssigned; // 추가 조건 체크 가능
        
        const allowed = ipAllowed && proxyActive && keywordAssigned && keywordAvailable;
        
        res.json({
            success: true,
            allowed,
            conditions: {
                ip_allowed: ipAllowed,
                proxy_active: proxyActive,
                keyword_assigned: keywordAssigned,
                keyword_available: keywordAvailable
            },
            next_available: null,
            restrictions: []
        });
        
    } catch (error) {
        console.error('❌ 조건 체크 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 허용된 키워드 목록 조회
router.get('/keywords/allowed', async (req, res) => {
    const pool = getPool();
    const { ip, proxy } = req.query;
    
    if (!ip) {
        return res.status(400).json({
            success: false,
            error: 'ip parameter is required'
        });
    }
    
    try {
        let query;
        let params;
        
        if (proxy) {
            // 특정 프록시에 대한 키워드
            query = `
                SELECT tk.id, tk.keyword, tk.code, tk.option, ikr.priority
                FROM v1_hub_ip_keyword_restrictions ikr
                JOIN v1_hub_test_keywords tk ON ikr.keyword_id = tk.id
                WHERE ikr.ip_address = $1 
                AND ikr.proxy_number = $2
                AND ikr.is_active = true
                ORDER BY ikr.priority, tk.id
            `;
            params = [ip, proxy];
        } else {
            // IP에 할당된 모든 키워드
            query = `
                SELECT DISTINCT tk.id, tk.keyword, tk.code, tk.option
                FROM v1_hub_ip_keyword_restrictions ikr
                JOIN v1_hub_test_keywords tk ON ikr.keyword_id = tk.id
                WHERE ikr.ip_address = $1 
                AND ikr.is_active = true
                ORDER BY tk.id
            `;
            params = [ip];
        }
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            ip,
            proxy: proxy || 'all',
            allowed_keywords: result.rows,
            total_count: result.rows.length
        });
        
    } catch (error) {
        console.error('❌ 키워드 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 프록시 할당 및 사용
router.get('/get', async (req, res) => {
    const pool = getPool();
    const { keyword_id } = req.query;
    
    try {
        // 사용 가능한 프록시 찾기 (use_count < 20)
        const proxyQuery = `
            SELECT * FROM v1_hub_proxies 
            WHERE status = 'active' 
            AND use_count < 20 
            ORDER BY use_count ASC, id ASC
            LIMIT 1
        `;
        
        const proxyResult = await pool.query(proxyQuery);
        
        if (proxyResult.rows.length === 0) {
            // 모든 프록시가 20회 이상 사용됨 - 토글 필요
            const needToggle = await pool.query(`
                SELECT * FROM v1_hub_proxies 
                WHERE status = 'active' 
                ORDER BY use_count DESC
                LIMIT 1
            `);
            
            if (needToggle.rows.length > 0) {
                const proxy = needToggle.rows[0];
                // 토글 시도
                try {
                    const toggleUrl = `http://${proxy.server_ip}:8080/toggle/${proxy.port % 100}`;
                    const toggleResponse = await axios.get(toggleUrl, { timeout: 10000 });
                    
                    if (toggleResponse.data.success) {
                        // 토글 성공 - use_count 리셋
                        await pool.query(`
                            UPDATE v1_hub_proxies 
                            SET use_count = 0, 
                                external_ip = $1,
                                last_toggle_at = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = $2
                        `, [toggleResponse.data.new_ip, proxy.id]);
                        
                        proxy.use_count = 0;
                        proxy.external_ip = toggleResponse.data.new_ip;
                        
                        return res.json({
                            success: true,
                            proxy: {
                                id: proxy.id,
                                server_ip: proxy.server_ip,
                                port: proxy.port,
                                external_ip: proxy.external_ip,
                                use_count: proxy.use_count
                            },
                            toggled: true,
                            toggle_result: toggleResponse.data
                        });
                    }
                } catch (toggleError) {
                    console.error('토글 실패:', toggleError.message);
                    // 토글 실패해도 프록시는 반환
                }
            }
            
            return res.status(503).json({
                success: false,
                error: 'No available proxy',
                message: 'All proxies exceeded usage limit'
            });
        }
        
        const proxy = proxyResult.rows[0];
        
        // use_count 증가
        await pool.query(`
            UPDATE v1_hub_proxies 
            SET use_count = use_count + 1,
                last_used_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [proxy.id]);
        
        res.json({
            success: true,
            proxy: {
                id: proxy.id,
                server_ip: proxy.server_ip,
                port: proxy.port,
                external_ip: proxy.external_ip,
                use_count: proxy.use_count + 1
            },
            toggled: false
        });
        
    } catch (error) {
        console.error('❌ 프록시 할당 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 프록시 사용 기록
router.post('/use', async (req, res) => {
    const pool = getPool();
    const { proxy_id, keyword_id, used_ip, success, response_time_ms } = req.body;
    
    if (!proxy_id || !keyword_id) {
        return res.status(400).json({
            success: false,
            error: 'proxy_id and keyword_id are required'
        });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO v1_hub_proxy_usage 
            (proxy_id, keyword_id, used_ip, success, response_time_ms)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [proxy_id, keyword_id, used_ip, success !== false, response_time_ms]);
        
        res.json({
            success: true,
            usage: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 사용 기록 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 키워드별 사용 IP 조회
router.get('/usage', async (req, res) => {
    const pool = getPool();
    const { keyword } = req.query;
    
    if (!keyword) {
        return res.status(400).json({
            success: false,
            error: 'keyword parameter is required'
        });
    }
    
    try {
        const query = `
            SELECT 
                pu.id,
                pu.used_ip,
                pu.success,
                pu.response_time_ms,
                pu.created_at,
                tk.keyword,
                tk.code,
                p.server_ip,
                p.port
            FROM v1_hub_proxy_usage pu
            JOIN v1_hub_test_keywords tk ON pu.keyword_id = tk.id
            JOIN v1_hub_proxies p ON pu.proxy_id = p.id
            WHERE tk.keyword = $1
            ORDER BY pu.created_at DESC
            LIMIT 100
        `;
        
        const result = await pool.query(query, [keyword]);
        
        // IP별 통계
        const ipStats = {};
        result.rows.forEach(row => {
            if (!ipStats[row.used_ip]) {
                ipStats[row.used_ip] = {
                    count: 0,
                    success_count: 0,
                    avg_response_time: 0,
                    last_used: row.created_at
                };
            }
            ipStats[row.used_ip].count++;
            if (row.success) ipStats[row.used_ip].success_count++;
        });
        
        res.json({
            success: true,
            keyword,
            total_usage: result.rows.length,
            usage_history: result.rows,
            ip_statistics: ipStats
        });
        
    } catch (error) {
        console.error('❌ 사용 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

// 프록시 상태 조회
router.get('/status', async (req, res) => {
    const pool = getPool();
    
    try {
        const proxies = await pool.query(`
            SELECT * FROM v1_hub_proxies 
            ORDER BY server_ip, port
        `);
        
        const keywords = await pool.query(`
            SELECT COUNT(*) as count FROM v1_hub_test_keywords
        `);
        
        const usage = await pool.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count
            FROM v1_hub_proxy_usage
        `);
        
        res.json({
            success: true,
            proxies: proxies.rows,
            total_proxies: proxies.rows.length,
            total_keywords: parseInt(keywords.rows[0].count),
            usage_stats: {
                total: parseInt(usage.rows[0].total || 0),
                success: parseInt(usage.rows[0].success_count || 0)
            }
        });
        
    } catch (error) {
        console.error('❌ 상태 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: 'Database error',
            message: error.message
        });
    }
});

module.exports = router;