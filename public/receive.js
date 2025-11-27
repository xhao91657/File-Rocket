// Socket.IO 连接
const socket = io();

// 全局变量
let currentPickupCode = null;
let receivedChunks = [];
let expectedFileInfo = null;
let downloadStartTime = null;
let totalBytesReceived = 0;
let isConnecting = false;
let isDownloading = false;
let totalChunks = 0;
let chunksReceived = 0;
let chunkMap = new Map(); // 用于存储接收到的chunk，按索引排序

// DOM 元素
const pickupCodeInput = document.getElementById('pickupCodeInput');
const connectBtn = document.getElementById('connectBtn');
const previewFileName = document.getElementById('previewFileName');
const previewFileSize = document.getElementById('previewFileSize');
const previewFileType = document.getElementById('previewFileType');
const downloadProgressFill = document.getElementById('downloadProgressFill');
const downloadProgressPercent = document.getElementById('downloadProgressPercent');
const downloadSpeed = document.getElementById('downloadSpeed');
const downloadFileName = document.getElementById('downloadFileName');
const errorText = document.getElementById('errorText');

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    setupInputHandlers();
    setupSocketListeners();
});

// 设置输入处理
function setupInputHandlers() {
    const boxes = document.querySelectorAll('.code-box');
    
    // 更新UI显示函数
    function updateDisplay(value) {
        boxes.forEach((box, index) => {
            const char = value[index] || '';
            box.textContent = char;
            
            // 处理填充状态
            if (char) {
                box.classList.add('filled');
                // 只有新输入的字符才加动画（简单判断：如果是当前输入的最后一位）
                if (index === value.length - 1) {
                    box.classList.add('pop');
                    setTimeout(() => box.classList.remove('pop'), 300);
                }
            } else {
                box.classList.remove('filled');
            }
            
            // 处理激活聚焦状态
            // 如果当前是待输入位，或者是已满时的最后一位，则激活
            if (index === value.length || (value.length === 4 && index === 3)) {
                box.classList.add('active');
            } else {
                box.classList.remove('active');
            }
        });
    }

    // 取件码输入格式化
    pickupCodeInput.addEventListener('input', function(e) {
        let value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (value.length > 4) {
            value = value.slice(0, 4);
        }
        e.target.value = value;
        
        // 更新视觉UI
        updateDisplay(value);
        
        // 自动连接当输入4位时
        if (value.length === 4) {
            setTimeout(() => {
                // 检查是否已经在连接或连接成功
                if (!isConnecting && !currentPickupCode) {
                    connectToSender();
                }
            }, 500);
        }
    });
    
    // 聚焦处理
    pickupCodeInput.addEventListener('focus', () => {
        updateDisplay(pickupCodeInput.value);
    });
    
    pickupCodeInput.addEventListener('blur', () => {
        boxes.forEach(box => box.classList.remove('active'));
    });
    
    // 回车键连接
    pickupCodeInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target.value.length === 4) {
            connectToSender();
        }
    });
    
    // 焦点到输入框
    pickupCodeInput.focus();
}

// 连接到发送方
function connectToSender() {
    const code = pickupCodeInput.value.trim();
    
    if (code.length !== 4) {
        alert('请输入4位取件码');
        return;
    }
    
    // 防止重复连接
    if (isConnecting) {
        console.log('正在连接中，忽略重复请求');
        return;
    }
    
    isConnecting = true;
    currentPickupCode = code;
    connectBtn.disabled = true;
    connectBtn.textContent = '连接中...';
    
    // 切换到连接中状态
    showStage('connecting-stage');
    
    // 尝试加入会话
    socket.emit('join-session', { pickupCode: code }, (response) => {
        isConnecting = false; // 重置连接状态
        
        if (response.success) {
            // 连接成功，等待文件信息
            console.log('连接成功，等待文件信息...');
        } else {
            // 连接失败
            showError(response.message || '连接失败');
            // 重置UI状态
            connectBtn.disabled = false;
            connectBtn.textContent = '连接';
        }
    });
}

// 设置Socket事件监听
function setupSocketListeners() {
    // 接收文件信息
    socket.on('file-info', (fileInfo) => {
        const { pickupCode: infoPickupCode, name, size, type } = fileInfo;
        
        // 严格验证：只接收属于当前房间的文件信息
        if (infoPickupCode && infoPickupCode !== currentPickupCode) {
            console.log(`[房间隔离] 忽略不属于当前房间的文件信息: ${infoPickupCode} (当前: ${currentPickupCode})`);
            return;
        }
        
        expectedFileInfo = { name, size, type };
        
        // 显示文件预览
        previewFileName.textContent = name || fileInfo.name;
        previewFileSize.textContent = formatFileSize(size || fileInfo.size);
        previewFileType.textContent = type || fileInfo.type || '未知类型';
        
        // 切换到确认阶段
        showStage('file-confirm-stage');
    });
    
    // 接收文件数据块 (已废弃，改为HTTP下载)
    // socket.on('file-chunk', ...) 已移除

    
    // 连接丢失
    socket.on('connection-lost', (data) => {
        const { pickupCode: lostPickupCode } = data || {};
        
        // 验证是否属于当前房间
        if (lostPickupCode && lostPickupCode !== currentPickupCode) {
            console.log(`[房间隔离] 忽略不属于当前房间的断连: ${lostPickupCode} (当前: ${currentPickupCode})`);
            return;
        }
        
        console.log(`[${currentPickupCode}] 检测到连接丢失`);
        isDownloading = false;
        showError('连接已断开');
    });
    
    // 传输进度更新（从服务器同步）
    socket.on('transfer-progress', (data) => {
        const { pickupCode: progressPickupCode, progress, chunkIndex, totalChunks: progressTotalChunks, bytesTransferred } = data;
        
        // 严格验证：只接收属于当前房间的进度更新
        if (progressPickupCode && progressPickupCode !== currentPickupCode) {
            console.log(`[房间隔离] 忽略不属于当前房间的进度: ${progressPickupCode} (当前: ${currentPickupCode})`);
            return;
        }
        
        // 更新本地变量用于速度计算
        if (progressTotalChunks) {
             totalChunks = progressTotalChunks;
        }
        
        // 使用服务器报告的实际字节数（更准确）
        if (bytesTransferred !== undefined && bytesTransferred > totalBytesReceived) {
            totalBytesReceived = bytesTransferred;
        }
        
        // 使用服务器同步的进度（更准确）
        if (progress !== undefined) {
            updateDownloadProgress(progress);
            
            // 如果进度达到100%，且没有在下载完成阶段，则切换状态
            if (progress >= 100 && isDownloading) {
                setTimeout(() => {
                    showStage('download-complete-stage');
                    isDownloading = false;
                    // 通知服务器下载完成（虽然服务器可能已经知道了，但作为确认）
                    socket.emit('download-complete', { pickupCode: currentPickupCode });
                }, 1000);
            }
        }
    });
    
    // 连接错误
    socket.on('connect_error', () => {
        showError('无法连接到服务器');
    });
    
    // 断开连接
    socket.on('disconnect', () => {
        console.log('Socket断开连接');
        isDownloading = false;
        if (currentPickupCode) {
            showError('与服务器断开连接');
        }
    });
}

// 接受文件传输
function acceptTransfer() {
    if (!expectedFileInfo) return;
    
    // 更新下载文件名显示
    downloadFileName.textContent = expectedFileInfo.name;
    
    // 切换到下载阶段
    showStage('download-stage');
    
    // 构造下载链接
    const downloadUrl = `/api/download/${currentPickupCode}`;
    
    // 使用 iframe 触发下载
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);
    
    // 几分钟后清理 iframe
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 60000);
    
    console.log(`[${currentPickupCode}] 已发起HTTP流式下载请求`);
    
    // 重置进度条
    updateDownloadProgress(0);
    isDownloading = true;
    downloadStartTime = Date.now();
    totalBytesReceived = 0; 
}

// 拒绝文件传输
function declineTransfer() {
    socket.disconnect();
    location.reload();
}

// 完成下载
function completeDownload() {
    if (!expectedFileInfo) {
        showError('文件接收失败：缺少文件信息');
        return;
    }
    
    // 确定使用哪种存储方式
    const hasChunkMap = chunkMap.size > 0;
    const hasChunkArray = receivedChunks.length > 0;
    
    if (!hasChunkMap && !hasChunkArray) {
        showError('文件接收失败：没有接收到任何数据');
        return;
    }
    
    try {
        let mergedArray;
        let totalSize;
        
        if (hasChunkMap) {
            // 使用Map方式：按索引排序合并
            console.log(`[${currentPickupCode}] 使用Map方式合并 ${chunkMap.size} 个chunk`);
            totalSize = Array.from(chunkMap.values()).reduce((sum, chunk) => sum + chunk.length, 0);
            mergedArray = new Uint8Array(totalSize);
            let offset = 0;
            
            // 按索引顺序合并
            const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b);
            for (const index of sortedIndices) {
                const chunk = chunkMap.get(index);
                mergedArray.set(chunk, offset);
                offset += chunk.length;
            }
        } else {
            // 使用数组方式：顺序合并
            console.log(`[${currentPickupCode}] 使用数组方式合并 ${receivedChunks.length} 个chunk`);
            totalSize = receivedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            mergedArray = new Uint8Array(totalSize);
            let offset = 0;
            
            for (const chunk of receivedChunks) {
                mergedArray.set(chunk, offset);
                offset += chunk.length;
            }
        }
        
        // 创建Blob并下载
        const blob = new Blob([mergedArray], { 
            type: expectedFileInfo.type || 'application/octet-stream' 
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = expectedFileInfo.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // 显示完成状态
        showStage('download-complete-stage');
        
        // 通知服务器和发送端下载完成
        socket.emit('download-complete', { pickupCode: currentPickupCode });
        console.log('文件下载完成，已通知发送端');
        
        // 清理数据和状态
        receivedChunks = [];
        chunkMap.clear();
        totalBytesReceived = 0;
        chunksReceived = 0;
        totalChunks = 0;
        isDownloading = false;
        
    } catch (error) {
        console.error('文件下载失败:', error);
        showError('文件下载失败');
    }
}

// 更新下载进度
function updateDownloadProgress(progress) {
    if (!isDownloading) {
        console.log('未在下载状态，不更新进度');
        return;
    }
    
    const percent = Math.round(Math.min(progress, 100));
    downloadProgressFill.style.width = `${percent}%`;
    downloadProgressPercent.textContent = `${percent}%`;
    
    // 计算下载速度
    if (downloadStartTime && totalBytesReceived > 0) {
        const elapsed = (Date.now() - downloadStartTime) / 1000;
        const speed = totalBytesReceived / elapsed;
        downloadSpeed.textContent = `${formatFileSize(speed)}/s`;
        
        // 定期向发送端发送速度更新（每秒发送一次，避免过于频繁）
        if (!window.lastSpeedUpdate || Date.now() - window.lastSpeedUpdate > 1000) {
            window.lastSpeedUpdate = Date.now();
            if (currentPickupCode && socket.connected) {
                socket.emit('transfer-speed', { 
                    pickupCode: currentPickupCode,
                    speed: speed
                });
            }
        }
    }
}

// 显示错误
function showError(message) {
    errorText.textContent = message;
    showStage('error-stage');
    
    // 重置所有状态
    isConnecting = false;
    isDownloading = false;
    currentPickupCode = null;
    connectBtn.disabled = false;
    connectBtn.textContent = '连接';
    
    // 清理数据
    receivedChunks = [];
    chunkMap.clear();
    totalBytesReceived = 0;
    chunksReceived = 0;
    totalChunks = 0;
}

// 显示指定阶段
function showStage(stageId) {
    // 隐藏所有阶段
    document.querySelectorAll('.stage').forEach(stage => {
        stage.classList.remove('active');
    });
    
    // 显示目标阶段
    document.getElementById(stageId).classList.add('active');
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

