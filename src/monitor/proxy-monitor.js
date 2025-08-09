const axios = require('axios');
const { getPool } = require('../db/pool');
const { getToggleQueue } = require('../services/toggle-queue');

class ProxyMonitor {
    constructor() {
        this.monitoringInterval = null;
        this.alertThreshold = {
            useCount: 18,        // 18회 이상이면 경고
            timeoutMs: 80000,    // 80초 타임아웃
            toggleCooldown: 30000 // 30초 쿨다운
        };
        this.lastToggleTime = {};
        this.stats = {
            totalChecks: 0,
            alertsSent: 0,
            autoToggles: 0
        };
    }

    // 모니터링 시작
    start(intervalMs = 30000) {
        if (this.monitoringInterval) {
            console.log('⚠️ 모니터링이 이미 실행 중입니다');
            return;
        }

        console.log(`🎯 프록시 모니터링 시작 (간격: ${intervalMs / 1000}초)`);
        
        // 즉시 한 번 실행
        this.checkProxies();
        
        // 주기적 실행
        this.monitoringInterval = setInterval(() => {
            this.checkProxies();
        }, intervalMs);
    }

    // 모니터링 중지
    stop() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            console.log('🛑 프록시 모니터링 중지');
        }
    }

    // 프록시 상태 체크
    async checkProxies() {
        const pool = getPool();
        this.stats.totalChecks++;

        try {
            // DB에서 모든 프록시 상태 조회
            const query = `
                SELECT 
                    p.*,
                    pim.current_ip as external_ip,
                    EXTRACT(EPOCH FROM (NOW() - p.last_used_at)) * 1000 as last_used_ms,
                    EXTRACT(EPOCH FROM (NOW() - p.last_toggle_at)) * 1000 as last_toggle_ms
                FROM v1_hub_proxies p
                LEFT JOIN v1_hub_proxy_ip_mapping pim ON p.id = pim.proxy_id
                WHERE p.status = 'active'
                ORDER BY p.use_count DESC
            `;
            
            const result = await pool.query(query);
            const proxies = result.rows;

            const alerts = [];
            const toggleCandidates = [];

            for (const proxy of proxies) {
                const proxyIdentifier = `${proxy.server_ip}:${proxy.port}`;
                
                // 1. 오래 사용되지 않은 프록시 체크
                if (proxy.last_used_ms && proxy.last_used_ms > this.alertThreshold.timeoutMs) {
                    alerts.push({
                        type: 'idle',
                        proxy: proxyIdentifier,
                        message: `프록시 ${proxyIdentifier} 미사용 (${Math.round(proxy.last_used_ms / 1000)}초)`
                    });
                }

                // 2. 사용량 체크
                if (proxy.use_count >= this.alertThreshold.useCount) {
                    alerts.push({
                        type: 'highUsage',
                        proxy: proxyIdentifier,
                        port: proxy.port,
                        useCount: proxy.use_count,
                        message: `프록시 ${proxyIdentifier} 사용량 경고 (${proxy.use_count}/20)`
                    });

                    // 토글 후보로 추가
                    if (proxy.use_count >= 20) {
                        toggleCandidates.push(proxy);
                    }
                }
            }

            // 경고 출력
            if (alerts.length > 0) {
                console.log(`\n⚠️ 프록시 경고 [${new Date().toLocaleString('ko-KR')}]`);
                alerts.forEach(alert => {
                    console.log(`  - ${alert.message}`);
                });
                this.stats.alertsSent += alerts.length;
            }

            // 자동 토글 처리
            if (toggleCandidates.length > 0) {
                await this.handleAutoToggle(toggleCandidates);
            }

            // 전체 상태 요약
            const summary = {
                total: proxies.length,
                active: proxies.filter(p => !p.last_seen_ms || p.last_seen_ms < this.alertThreshold.timeoutMs).length,
                highUsage: proxies.filter(p => p.use_count >= this.alertThreshold.useCount).length,
                needToggle: toggleCandidates.length
            };

            if (process.env.NODE_ENV !== 'production') {
                console.log(`📊 모니터링 체크 #${this.stats.totalChecks}: 활성 ${summary.active}/${summary.total}, 고사용 ${summary.highUsage}, 토글필요 ${summary.needToggle}`);
            }

            return { alerts, summary };

        } catch (error) {
            console.error('❌ 프록시 모니터링 오류:', error.message);
            return { alerts: [], summary: null };
        }
    }

    // 자동 토글 처리 (큐 사용)
    async handleAutoToggle(candidates) {
        const toggleQueue = getToggleQueue();
        
        for (const proxy of candidates) {
            // 토글 큐에 추가
            toggleQueue.addToQueue({
                id: proxy.id,
                port: proxy.port,
                server_ip: proxy.server_ip,
                external_ip: proxy.external_ip,
                use_count: proxy.use_count
            });
            
            this.stats.autoToggles++;
        }
        
        console.log(`📥 ${candidates.length}개 프록시를 토글 큐에 추가`);
    }


    // 통계 조회
    getStats() {
        return {
            ...this.stats,
            isRunning: !!this.monitoringInterval,
            lastToggleTimes: this.lastToggleTime
        };
    }
}

// 싱글톤 인스턴스
let monitorInstance = null;

function getMonitor() {
    if (!monitorInstance) {
        monitorInstance = new ProxyMonitor();
    }
    return monitorInstance;
}

module.exports = {
    ProxyMonitor,
    getMonitor
};