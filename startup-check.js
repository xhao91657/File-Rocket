// 启动检查脚本
const fs = require('fs');
const path = require('path');

console.log('🔍 File-Rocket 4.0 启动检查...\n');

// 检查配置文件
if (!fs.existsSync('config.json')) {
    console.log('⚠️  未发现 config.json，正在创建默认配置...');
    
    const defaultConfig = {
        adminPassword: "7428",
        features: {
            memoryStreaming: true,
            serverStorage: false,
            p2pDirect: false
        },
        storageConfig: {
            uploadDir: "./files",
            maxStorageSize: 10737418240,
            fileRetentionHours: 24,
            deleteOnDownload: false
        },
        security: {
            maxCodeAttempts: 10,
            sessionTimeout: 1800000,
            adminTokenExpiry: 3600000
        }
    };
    
    fs.writeFileSync('config.json', JSON.stringify(defaultConfig, null, 2));
    console.log('✅ 默认配置文件已创建');
    console.log('⚠️  默认管理员密码: 7428 （请登录后立即修改！）\n');
} else {
    console.log('✅ 配置文件存在');
    
    // 验证配置文件格式
    try {
        const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        
        if (!config.adminPassword) {
            console.log('⚠️  警告: 管理员密码未设置');
        }
        
        if (!config.features) {
            console.log('⚠️  警告: 功能配置缺失');
        }
        
        console.log('✅ 配置文件格式正确\n');
    } catch (error) {
        console.error('❌ 配置文件格式错误:', error.message);
        process.exit(1);
    }
}

// 检查并创建文件存储目录
try {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const uploadDir = path.resolve(config.storageConfig.uploadDir);
    
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('✅ 文件存储目录已创建:', uploadDir);
    } else {
        const files = fs.readdirSync(uploadDir);
        console.log(`✅ 文件存储目录存在: ${uploadDir} (${files.length} 个文件)`);
    }
} catch (error) {
    console.error('❌ 创建存储目录失败:', error.message);
}

// 检查必要的依赖模块
console.log('\n📦 检查依赖模块...');
const requiredModules = ['express', 'socket.io', 'multer'];
const missingModules = [];

for (const module of requiredModules) {
    try {
        require.resolve(module);
        console.log(`✅ ${module}`);
    } catch (error) {
        console.log(`❌ ${module} (缺失)`);
        missingModules.push(module);
    }
}

if (missingModules.length > 0) {
    console.log('\n⚠️  缺少依赖模块，请运行: npm install');
    process.exit(1);
}

// 检查端口占用
const PORT = process.env.PORT || 3000;
console.log(`\n🌐 服务将在端口 ${PORT} 启动`);

// 安全提示
console.log('\n🔒 安全提示:');
console.log('   1. 首次登录后请立即修改管理员密码');
console.log('   2. 管理员入口: 点击首页版权文字 4 次');
console.log('   3. 生产环境建议启用 HTTPS');
console.log('   4. 定期清理 files/ 目录中的过期文件');

console.log('\n✅ 启动检查完成!\n');

