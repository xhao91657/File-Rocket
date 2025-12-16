// 简单的速率限制器
class RateLimiter {
    constructor(maxAttempts = 10, windowMs = 60000) {
        this.maxAttempts = maxAttempts;
        this.windowMs = windowMs;
        this.attempts = new Map();
    }
    
    // 检查是否超过限制
    check(identifier) {
        const now = Date.now();
        const record = this.attempts.get(identifier) || { count: 0, resetTime: now + this.windowMs };
        
        // 如果时间窗口已过，重置
        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + this.windowMs;
        }
        
        record.count++;
        this.attempts.set(identifier, record);
        
        // 定期清理过期记录
        if (this.attempts.size > 10000) {
            this.cleanup();
        }
        
        return record.count <= this.maxAttempts;
    }
    
    // 清理过期记录
    cleanup() {
        const now = Date.now();
        for (const [key, record] of this.attempts.entries()) {
            if (now > record.resetTime) {
                this.attempts.delete(key);
            }
        }
    }
    
    // 重置特定标识符
    reset(identifier) {
        this.attempts.delete(identifier);
    }
}

module.exports = RateLimiter;

