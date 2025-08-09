const express = require('express');
const router = express.Router();
const { getPool } = require('../db/pool');

// 할당 중인 조합을 저장 (중복 방지)
const allocatedCombinations = new Map();

// 할당 해제 (30초 후 자동 해제)
function releaseAllocation(key) {
    setTimeout(() => {
        allocatedCombinations.delete(key);
    }, 30000);
}

// GET /api/allocation/proxy-keyword - 프록시와 키워드 할당
router.get('/proxy-keyword', async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 사용 가능한 프록시 찾기 (use_count < 20)
        const availableProxies = await client.query(`
            SELECT 
                p.id,
                p.port,
                p.server_ip,
                COALESCE(pm.current_ip, p.external_ip) as external_ip,
                p.use_count
            FROM v1_hub_proxies p
            LEFT JOIN v1_hub_proxy_ip_mapping pm ON p.id = pm.proxy_id AND pm.is_active = true
            WHERE p.use_count < 20
                AND (p.status IS NULL OR p.status = 'active')
            ORDER BY p.use_count ASC
            FOR UPDATE OF p SKIP LOCKED
        `);
        
        if (availableProxies.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(503).json({
                success: false,
                error: '사용 가능한 프록시가 없습니다'
            });
        }
        
        // 2. 각 프록시에 대해 사용 가능한 키워드 찾기
        let selectedProxy = null;
        let selectedKeyword = null;
        
        for (const proxy of availableProxies.rows) {
            // 현재 시간 기준 조건
            const now = new Date();
            const oneMinuteAgo = new Date(now - 60 * 1000);
            const tenMinutesAgo = new Date(now - 10 * 60 * 1000);
            
            // 사용 가능한 키워드 찾기
            const availableKeywords = await client.query(`
                WITH available_keywords AS (
                    SELECT 
                        k.id,
                        k.keyword,
                        k.code,
                        k.option,
                        COALESCE(MAX(r.updated_at), '2000-01-01'::timestamp) as last_used
                    FROM v1_hub_test_keywords k
                    LEFT JOIN v1_hub_ip_keyword_restrictions r 
                        ON k.id = r.keyword_id 
                        AND r.ip_address = $1
                        AND r.is_active = true
                    WHERE 
                        -- 마지막 사용 시간이 1분 이상 경과했거나 사용 기록이 없음
                        (r.updated_at IS NULL OR r.updated_at < $2)
                        -- 동일 IP로 10분 이내 사용하지 않음
                        AND NOT EXISTS (
                            SELECT 1 
                            FROM v1_hub_ip_keyword_restrictions r2
                            WHERE r2.keyword_id = k.id
                                AND r2.ip_address = $1
                                AND r2.updated_at > $3
                                AND r2.is_active = true
                        )
                    GROUP BY k.id, k.keyword, k.code, k.option
                    HAVING COALESCE(MAX(r.updated_at), '2000-01-01'::timestamp) < $2
                    ORDER BY last_used ASC
                    LIMIT 10
                )
                SELECT * FROM available_keywords
                FOR UPDATE SKIP LOCKED
            `, [proxy.external_ip, oneMinuteAgo, tenMinutesAgo]);
            
            if (availableKeywords.rows.length > 0) {
                // 할당되지 않은 조합 찾기
                for (const keyword of availableKeywords.rows) {
                    const allocationKey = `${proxy.id}-${keyword.id}`;
                    
                    if (!allocatedCombinations.has(allocationKey)) {
                        selectedProxy = proxy;
                        selectedKeyword = keyword;
                        allocatedCombinations.set(allocationKey, Date.now());
                        releaseAllocation(allocationKey);
                        break;
                    }
                }
                
                if (selectedProxy && selectedKeyword) {
                    break;
                }
            }
        }
        
        if (!selectedProxy || !selectedKeyword) {
            await client.query('ROLLBACK');
            return res.status(503).json({
                success: false,
                error: '조건을 만족하는 프록시-키워드 조합이 없습니다'
            });
        }
        
        // 3. 프록시 사용 횟수 증가
        await client.query(`
            UPDATE v1_hub_proxies 
            SET use_count = use_count + 1 
            WHERE id = $1
        `, [selectedProxy.id]);
        
        // 4. IP-키워드 제한 기록 업데이트 또는 생성
        // 먼저 기존 레코드가 있는지 확인
        const existingRecord = await client.query(`
            SELECT id FROM v1_hub_ip_keyword_restrictions
            WHERE ip_address = $1 AND keyword_id = $2
            LIMIT 1
        `, [selectedProxy.external_ip, selectedKeyword.id]);
        
        if (existingRecord.rows.length > 0) {
            // 기존 레코드 업데이트
            await client.query(`
                UPDATE v1_hub_ip_keyword_restrictions
                SET updated_at = NOW(),
                    proxy_number = $3,
                    is_active = true
                WHERE ip_address = $1 AND keyword_id = $2
            `, [selectedProxy.external_ip, selectedKeyword.id, selectedProxy.port]);
        } else {
            // 새 레코드 생성
            await client.query(`
                INSERT INTO v1_hub_ip_keyword_restrictions 
                (ip_address, keyword_id, proxy_number, is_active, priority, created_at, updated_at)
                VALUES ($1, $2, $3, true, 1, NOW(), NOW())
            `, [selectedProxy.external_ip, selectedKeyword.id, selectedProxy.port]);
        }
        
        // 5. 프록시 사용 기록 저장
        await client.query(`
            INSERT INTO v1_hub_proxy_usage 
            (proxy_id, keyword_id, used_ip, success, created_at)
            VALUES ($1, $2, $3, true, NOW())
        `, [selectedProxy.id, selectedKeyword.id, selectedProxy.external_ip]);
        
        await client.query('COMMIT');
        
        // 응답
        res.json({
            success: true,
            proxy: {
                id: selectedProxy.id,
                port: selectedProxy.port,
                server_ip: selectedProxy.server_ip,
                external_ip: selectedProxy.external_ip,
                use_count: selectedProxy.use_count + 1
            },
            keyword: {
                id: selectedKeyword.id,
                keyword: selectedKeyword.keyword,
                code: selectedKeyword.code,
                option: selectedKeyword.option
            },
            allocation_key: `${selectedProxy.id}-${selectedKeyword.id}`
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 프록시-키워드 할당 오류:', error);
        res.status(500).json({
            success: false,
            error: '프록시-키워드 할당 중 오류가 발생했습니다'
        });
    } finally {
        client.release();
    }
});

// GET /api/allocation/status - 할당 상태 확인
router.get('/status', async (req, res) => {
    const pool = getPool();
    
    try {
        // 프록시별 사용 통계
        const proxyStats = await pool.query(`
            SELECT 
                p.port,
                p.use_count,
                pm.current_ip as external_ip,
                COUNT(DISTINCT r.keyword_id) as assigned_keywords
            FROM v1_hub_proxies p
            LEFT JOIN v1_hub_proxy_ip_mapping pm ON p.id = pm.proxy_id AND pm.is_active = true
            LEFT JOIN v1_hub_ip_keyword_restrictions r 
                ON r.ip_address = pm.current_ip 
                AND r.is_active = true
                AND r.updated_at > NOW() - INTERVAL '10 minutes'
            WHERE (p.status IS NULL OR p.status = 'active')
            GROUP BY p.id, p.port, p.use_count, pm.current_ip
            ORDER BY p.port
        `);
        
        // 키워드별 최근 사용 통계
        const keywordStats = await pool.query(`
            SELECT 
                k.keyword,
                COUNT(DISTINCT r.ip_address) as recent_ips,
                MAX(r.updated_at) as last_used
            FROM v1_hub_test_keywords k
            LEFT JOIN v1_hub_ip_keyword_restrictions r 
                ON k.id = r.keyword_id 
                AND r.updated_at > NOW() - INTERVAL '10 minutes'
            GROUP BY k.id, k.keyword
            ORDER BY last_used DESC NULLS LAST
            LIMIT 10
        `);
        
        res.json({
            success: true,
            allocated_combinations: allocatedCombinations.size,
            proxy_stats: proxyStats.rows,
            keyword_stats: keywordStats.rows
        });
        
    } catch (error) {
        console.error('❌ 상태 확인 오류:', error);
        res.status(500).json({
            success: false,
            error: '상태 확인 중 오류가 발생했습니다'
        });
    }
});

// POST /api/allocation/release - 할당 해제
router.post('/release', async (req, res) => {
    const { allocation_key } = req.body;
    
    if (!allocation_key) {
        return res.status(400).json({
            success: false,
            error: 'allocation_key가 필요합니다'
        });
    }
    
    allocatedCombinations.delete(allocation_key);
    
    res.json({
        success: true,
        message: '할당이 해제되었습니다'
    });
});

module.exports = router;