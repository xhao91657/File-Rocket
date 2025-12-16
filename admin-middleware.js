const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 管理员令牌存储（生产环境应使用 Redis 等）
const adminTokens = new Map();

// 读取配置
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('加载配置失败:', error);
    return null;
  }
}

// 保存配置
function saveConfig(config) {
  try {
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存配置失败:', error);
    return false;
  }
}

// 生成安全令牌
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证管理员密码
function verifyAdminPassword(password) {
  const config = loadConfig();
  if (!config) return false;
  return password === config.adminPassword;
}

// 创建管理员会话
function createAdminSession() {
  const token = generateToken();
  const expiry = Date.now() + (loadConfig().security.adminTokenExpiry || 3600000);
  adminTokens.set(token, { expiry });
  
  // 自动清理过期令牌
  setTimeout(() => {
    adminTokens.delete(token);
  }, expiry - Date.now());
  
  return token;
}

// 验证管理员令牌
function verifyAdminToken(token) {
  if (!token) return false;
  const session = adminTokens.get(token);
  if (!session) return false;
  if (Date.now() > session.expiry) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

// Express 中间件：保护管理员路由
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ 
      success: false, 
      message: '未授权访问' 
    });
  }
  
  next();
}

// 获取当前功能配置
function getFeatureConfig() {
  const config = loadConfig();
  return config ? config.features : null;
}

// 更新功能配置
function updateFeatureConfig(features) {
  const config = loadConfig();
  if (!config) return false;
  
  config.features = { ...config.features, ...features };
  return saveConfig(config);
}

module.exports = {
  loadConfig,
  saveConfig,
  verifyAdminPassword,
  createAdminSession,
  verifyAdminToken,
  requireAdmin,
  getFeatureConfig,
  updateFeatureConfig
};

