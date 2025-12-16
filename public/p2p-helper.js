// P2P WebRTC 文件传输辅助类
class P2PFileTransfer {
    constructor(socket) {
        this.socket = socket;
        this.peerConnection = null;
        this.dataChannel = null;
        this.pickupCode = null;
        this.isSender = false;
        this.natType = null;
        
        // STUN 服务器列表
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
        
        this.setupSocketListeners();
    }
    
    // 设置Socket监听器
    setupSocketListeners() {
        this.socket.on('p2p-offer', async (data) => {
            if (data.pickupCode === this.pickupCode && !this.isSender) {
                await this.handleOffer(data.offer);
            }
        });
        
        this.socket.on('p2p-answer', async (data) => {
            if (data.pickupCode === this.pickupCode && this.isSender) {
                await this.handleAnswer(data.answer);
            }
        });
        
        this.socket.on('p2p-ice-candidate', async (data) => {
            if (data.pickupCode === this.pickupCode) {
                await this.handleIceCandidate(data.candidate);
            }
        });
    }
    
    // 初始化P2P连接（发送方）
    async initSender(pickupCode, file) {
        this.pickupCode = pickupCode;
        this.isSender = true;
        this.file = file;
        
        // 检测NAT类型
        await this.detectNATType();
        
        // 创建PeerConnection
        this.createPeerConnection();
        
        // 创建数据通道
        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
            ordered: true,
            maxRetransmits: 3
        });
        
        this.setupDataChannel();
        
        // 创建Offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        // 发送Offer给接收方
        this.socket.emit('p2p-offer', {
            pickupCode: this.pickupCode,
            offer: offer
        });
        
        return this.natType;
    }
    
    // 初始化P2P连接（接收方）
    async initReceiver(pickupCode) {
        this.pickupCode = pickupCode;
        this.isSender = false;
        
        // 检测NAT类型
        await this.detectNATType();
        
        return this.natType;
    }
    
    // 创建PeerConnection
    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: this.iceServers
        });
        
        // 监听ICE候选
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('p2p-ice-candidate', {
                    pickupCode: this.pickupCode,
                    candidate: event.candidate
                });
            }
        };
        
        // 监听连接状态
        this.peerConnection.onconnectionstatechange = () => {
            console.log('P2P连接状态:', this.peerConnection.connectionState);
            
            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(this.peerConnection.connectionState);
            }
        };
        
        // 接收方监听数据通道
        if (!this.isSender) {
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
        }
    }
    
    // 设置数据通道
    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('P2P数据通道已打开');
            
            if (this.onChannelOpen) {
                this.onChannelOpen();
            }
            
            // 发送方开始发送文件
            if (this.isSender && this.file) {
                this.sendFile();
            }
        };
        
        this.dataChannel.onmessage = (event) => {
            // 接收方处理接收到的数据
            if (!this.isSender && this.onDataReceived) {
                this.onDataReceived(event.data);
            }
        };
        
        this.dataChannel.onerror = (error) => {
            console.error('P2P数据通道错误:', error);
            
            if (this.onError) {
                this.onError(error);
            }
        };
    }
    
    // 处理Offer
    async handleOffer(offer) {
        this.createPeerConnection();
        
        await this.peerConnection.setRemoteDescription(offer);
        
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        // 发送Answer
        this.socket.emit('p2p-answer', {
            pickupCode: this.pickupCode,
            answer: answer
        });
    }
    
    // 处理Answer
    async handleAnswer(answer) {
        await this.peerConnection.setRemoteDescription(answer);
    }
    
    // 处理ICE候选
    async handleIceCandidate(candidate) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
        }
    }
    
    // 发送文件
    async sendFile() {
        if (!this.file || !this.dataChannel) return;
        
        // 动态chunk大小：根据文件大小调整
        let chunkSize = 16384; // 默认16KB for WebRTC
        if (this.file.size > 100 * 1024 * 1024) { // >100MB
            chunkSize = 65536; // 64KB chunks
        } else if (this.file.size > 10 * 1024 * 1024) { // >10MB
            chunkSize = 32768; // 32KB chunks
        }
        const fileSize = this.file.size;
        const totalChunks = Math.ceil(fileSize / chunkSize);
        
        // 先发送文件元信息
        const metadata = JSON.stringify({
            type: 'metadata',
            name: this.file.name,
            size: this.file.size,
            mimeType: this.file.type
        });
        this.dataChannel.send(metadata);
        
        // 发送文件数据
        let offset = 0;
        let lastProgressUpdate = Date.now();
        const progressUpdateInterval = 100; // 每100ms更新一次进度
        const reader = new FileReader();
        
        const readSlice = () => {
            const slice = this.file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        };
        
        reader.onload = (e) => {
            if (this.dataChannel.readyState === 'open') {
                // 控制发送速率，避免缓冲区溢出
                const bufferedAmount = this.dataChannel.bufferedAmount;
                const maxBuffered = 16 * 1024 * 1024; // 16MB缓冲上限
                
                if (bufferedAmount > maxBuffered) {
                    // 如果缓冲区太满，延迟发送
                    setTimeout(() => reader.onload(e), 10);
                    return;
                }
                
                this.dataChannel.send(e.target.result);
                offset += e.target.result.byteLength;
                
                // 限制进度更新频率，避免UI卡顿
                const now = Date.now();
                if (now - lastProgressUpdate >= progressUpdateInterval || offset >= fileSize) {
                    const progress = (offset / fileSize) * 100;
                    
                    if (this.onProgress) {
                        this.onProgress(progress, offset, fileSize);
                    }
                    lastProgressUpdate = now;
                }
                
                if (offset < fileSize) {
                    readSlice();
                } else {
                    console.log('P2P文件发送完成');
                    
                    // 发送完成标记
                    this.dataChannel.send(JSON.stringify({ type: 'complete' }));
                    
                    if (this.onComplete) {
                        this.onComplete();
                    }
                }
            }
        };
        
        readSlice();
    }
    
    // NAT类型检测
    async detectNATType() {
        try {
            const pc = new RTCPeerConnection({ iceServers: this.iceServers });
            
            // 收集ICE候选
            const candidates = [];
            
            await new Promise((resolve) => {
                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        candidates.push(event.candidate);
                    } else {
                        resolve();
                    }
                };
                
                pc.createDataChannel('test');
                pc.createOffer().then(offer => pc.setLocalDescription(offer));
                
                // 5秒超时
                setTimeout(resolve, 5000);
            });
            
            pc.close();
            
            // 分析候选类型
            const hasHost = candidates.some(c => c.candidate.includes('typ host'));
            const hasSrflx = candidates.some(c => c.candidate.includes('typ srflx'));
            const hasRelay = candidates.some(c => c.candidate.includes('typ relay'));
            
            // NAT类型判断（支持NAT0/1/2/3/4）
            if (hasHost && !hasSrflx) {
                this.natType = { type: 'NAT0', name: '公网IP', success: 95 };
            } else if (hasSrflx) {
                const srflxCount = candidates.filter(c => c.candidate.includes('typ srflx')).length;
                if (srflxCount === 1) {
                    this.natType = { type: 'NAT1', name: '全锥型NAT', success: 90 };
                } else if (srflxCount === 2) {
                    this.natType = { type: 'NAT2', name: '限制型NAT', success: 75 };
                } else {
                    this.natType = { type: 'NAT3', name: '端口限制型NAT', success: 50 };
                }
            } else if (hasRelay) {
                this.natType = { type: 'NAT4', name: '对称型NAT', success: 20 };
            } else {
                this.natType = { type: 'NAT4', name: '对称型NAT', success: 20 };
            }
            
            console.log('NAT类型检测结果:', this.natType);
            
        } catch (error) {
            console.error('NAT检测失败:', error);
            this.natType = { type: 'UNKNOWN', name: '未知', success: 50 };
        }
    }
    
    // 关闭连接
    close() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }
}

