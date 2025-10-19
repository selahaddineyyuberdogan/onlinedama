const express = require('express');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = app.listen(8080, () => console.log('🟢 Sunucu 8080\'de çalışıyor...'));
const wss = new WebSocket.Server({ server });

// MySQL bağlantısı
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'yourpassword',
    database: 'dama_db'
});

// JWT Secret
const JWT_SECRET = 'dama-secret-key-2024';

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Users tablosu oluştur
async function createUsersTable() {
    try {
        const [userTables] = await db.execute('SHOW TABLES LIKE "users"');
        if (userTables.length === 0) {
            console.log('👥 Users tablosu oluşturuluyor...');
            await db.execute(`
                CREATE TABLE users (
                    id VARCHAR(36) PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    email VARCHAR(100) UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    is_guest BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Users tablosu oluşturuldu.');
        }
    } catch (err) {
        console.error('❌ Users tablosu hatası:', err.message);
    }
}

// Tables tablosu oluştur
async function createTablesTable() {
    try {
        const [tables] = await db.execute('SHOW TABLES LIKE "tables"');
        if (tables.length === 0) {
            console.log('📋 Tables tablosu oluşturuluyor...');
            await db.execute(`
                CREATE TABLE tables (
                    id VARCHAR(36) PRIMARY KEY,
                    game_state TEXT,
                    status ENUM('open', 'full', 'playing', 'finished') DEFAULT 'open',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Tables tablosu oluşturuldu.');
        } else {
            const [columns] = await db.execute('SHOW COLUMNS FROM tables LIKE "game_state"');
            if (columns.length === 0) {
                console.log('game_state kolonu ekleniyor...');
                await db.execute('ALTER TABLE tables ADD COLUMN game_state TEXT');
                console.log('✅ game_state kolonu eklendi.');
            }
        }
    } catch (err) {
        console.error('❌ Tables tablosu hatası:', err.message);
    }
}

// Veritabanı başlat
async function initDatabase() {
    try {
        const [rows] = await db.execute('SELECT 1');
        console.log('🔗 MySQL bağlantısı başarılı:', rows);
        await createUsersTable();
        await createTablesTable();
    } catch (err) {
        console.error('❌ MySQL bağlantı hatası:', err.message);
        process.exit(1);
    }
}
initDatabase();

// === HESAP SİSTEMİ ROUTES ===
app.post('/register', async (req, res) => {
    console.log('📝 Kayıt isteği:', req.body);
    const { username, email, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    
    try {
        // Email kontrolü
        if (email) {
            const [existingEmail] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail.length > 0) {
                return res.status(400).json({ error: 'Bu email zaten kayıtlı' });
            }
        }
        
        // Username kontrolü
        const [existingUser] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        
        await db.execute(
            'INSERT INTO users (id, username, email, password, is_guest) VALUES (?, ?, ?, ?, ?)',
            [userId, username, email || null, hashedPassword, false]
        );
        
        const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('✅ Kullanıcı kaydedildi:', username);
        res.json({
            success: true,
            token,
            user: { id: userId, username }
        });
        
    } catch (err) {
        console.error('❌ Kayıt hatası:', err);
        res.status(500).json({ error: 'Kayıt sırasında hata oluştu' });
    }
});

app.post('/login', async (req, res) => {
    console.log('🔐 Giriş isteği:', req.body.username);
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    
    try {
        const [users] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
        }
        
        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(400).json({ error: 'Yanlış şifre' });
        }
        
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('✅ Kullanıcı giriş yaptı:', username);
        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username }
        });
        
    } catch (err) {
        console.error('❌ Giriş hatası:', err);
        res.status(500).json({ error: 'Giriş sırasında hata oluştu' });
    }
});

app.post('/guest-login', (req, res) => {
    console.log('👻 Misafir giriş isteği:', req.body);
    const { username } = req.body;
    
    if (!username || username.trim().length < 2) {
        return res.status(400).json({ error: 'Misafir kullanıcı adı en az 2 karakter olmalı' });
    }
    
    const guestId = uuidv4();
    const token = jwt.sign({ userId: guestId, username: username.trim(), isGuest: true }, JWT_SECRET, { expiresIn: '7d' });
    
    console.log('✅ Misafir giriş yaptı:', username.trim());
    res.json({
        success: true,
        token,
        user: { id: guestId, username: username.trim(), isGuest: true }
    });
});

// Token doğrulama middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token gerekli' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Geçersiz token' });
        }
        req.user = user;
        next();
    });
}

// === OYUN ROUTES ===
app.post('/create-table', authenticateToken, async (req, res) => {
    const tableId = uuidv4();
    const initialGameState = {
        pieceList: [],
        positionArray: Array(8).fill().map(() => Array(8).fill(-1)),
        turn: 0,
        firstTurnMove: true,
        simpleMoveMade: false,
        startedJumping: false,
        firstMovedPiece: null,
        movePath: []
    };
    
    try {
        await db.execute('INSERT INTO tables (id, game_state, status) VALUES (?, ?, ?)', 
            [tableId, JSON.stringify(initialGameState), 'open']);
        
        console.log(`📋 Masa oluşturuldu: tableId=${tableId}, owner=${req.user.username}`);
        res.json({ tableId, link: `/game.html?table=${tableId}` });
        
    } catch (err) {
        console.error('❌ Masa oluşturma hatası:', err.message);
        res.status(500).json({ error: 'Masa oluşturulamadı' });
    }
});

app.get('/tables', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, status FROM tables WHERE status = "open" OR status = "playing"');
        console.log('📋 Masalar gönderildi:', rows.length, 'masa bulundu');
        res.json(rows);
    } catch (err) {
        console.error('❌ Masalar alınamadı:', err.message);
        res.status(500).json({ error: 'Masalar alınamadı' });
    }
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// === WEBSOCKET ===
const rooms = new Map();

wss.on('connection', async (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const tableId = urlParams.get('table');
    const token = urlParams.get('token');
    
    console.log(`🟢 Yeni bağlantı: tableId=${tableId}, token=${token ? 'var' : 'yok'}`);
    
    // Token doğrula
    let user = null;
    if (!token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Token gerekli!' }));
        ws.close();
        return;
    }
    
    try {
        user = jwt.verify(token, JWT_SECRET);
        console.log('✅ Token doğrulandı:', user.username);
    } catch (err) {
        console.error('❌ Token hatası:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz token!' }));
        ws.close();
        return;
    }
    
    // Masa kontrolü
    let table;
    try {
        const [rows] = await db.execute('SELECT * FROM tables WHERE id = ?', [tableId]);
        if (rows.length === 0) {
            ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz masa!' }));
            ws.close();
            console.log(`❌ Geçersiz masa: tableId=${tableId}`);
            return;
        }
        table = rows[0];
        console.log(`📋 Masa bulundu: tableId=${tableId}, status=${table.status}`);
    } catch (err) {
        console.error('❌ Masa kontrol hatası:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Veritabanı hatası!' }));
        ws.close();
        return;
    }

    // Room oluştur veya al
    if (!rooms.has(tableId)) {
        rooms.set(tableId, { 
            players: [], 
            gameState: table.game_state ? JSON.parse(table.game_state) : {
                pieceList: [],
                positionArray: Array(8).fill().map(() => Array(8).fill(-1)),
                turn: 0,
                firstTurnMove: true,
                simpleMoveMade: false,
                startedJumping: false,
                firstMovedPiece: null,
                movePath: []
            },
            playerColors: {},
            playerNames: {}
        });
    }
    const room = rooms.get(tableId);

    if (room.players.length >= 2 || table.status === 'finished') {
        ws.send(JSON.stringify({ type: 'error', message: 'Masa dolu veya oyun bitti!' }));
        ws.close();
        console.log(`❌ Masa dolu: tableId=${tableId}, status=${table.status}, players=${room.players.length}`);
        return;
    }

    // Oyuncuyu ekle
    const playerColor = room.players.length === 0 ? 0 : 1; // 0: Siyah, 1: Beyaz
    room.players.push(ws);
    room.playerColors[ws] = playerColor;
    room.playerNames[ws] = user.username;
    
    ws.tableId = tableId;
    ws.playerColor = playerColor;
    ws.username = user.username;
    
    console.log(`👤 Oyuncu eklendi: tableId=${tableId}, isim=${ws.username}, renk=${playerColor === 0 ? 'Siyah' : 'Beyaz'}, toplam=${room.players.length}/2`);

    // Oyuncuya bilgilerini gönder
    ws.send(JSON.stringify({ 
        type: 'playerInfo', 
        playerColor,
        username: ws.username 
    }));

    // Mevcut durumu gönder (ilk oyuncu için)
    sendGameStateToPlayer(ws, room, tableId);

    if (room.players.length === 2) {
        try {
            await db.execute('UPDATE tables SET status = "playing" WHERE id = ?', [tableId]);
            console.log(`🎮 Oyun başladı: tableId=${tableId}`);
            
            // Her iki oyuncuya da rakip ismini gönder
            room.players.forEach((player) => {
                if (player.readyState === WebSocket.OPEN) {
                    const opponentName = room.players.find(p => p !== player)?.username || 'Rakip';
                    player.send(JSON.stringify({ 
                        type: 'gameStart',
                        opponentName 
                    }));
                }
            });
            
            // İlk oyun durumunu gönder
            room.players.forEach(player => sendGameStateToPlayer(player, room, tableId));
        } catch (err) {
            console.error('❌ Oyun başlatma hatası:', err.message);
        }
    }

    // WebSocket mesaj handler - TAMAMEN DÜZELTİLMİŞ
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Mesaj alındı: tableId=${tableId}, type=${data.type}, turn=${data.turn}`);
            
            const room = rooms.get(tableId);
            if (!room) {
                console.error('❌ Oda bulunamadı:', tableId);
                return;
            }
            
            if (data.type === 'initBoard') {
                console.log('🏁 Tahta başlatılıyor:', data.pieceList?.length || 0, 'taş');
                
                room.gameState.pieceList = data.pieceList || [];
                room.gameState.positionArray = data.positionArray || Array(8).fill().map(() => Array(8).fill(-1));
                room.gameState.turn = data.turn || 0;
                
                await db.execute('UPDATE tables SET game_state = ? WHERE id = ?', 
                    [JSON.stringify(room.gameState), tableId]);
                
                // TÜM OYUNCULARA initBoard GÖNDER
                room.players.forEach(player => {
                    if (player.readyState === WebSocket.OPEN) {
                        player.send(JSON.stringify({
                            type: 'initBoard',
                            pieceList: room.gameState.pieceList,
                            positionArray: room.gameState.positionArray,
                            turn: room.gameState.turn
                        }));
                    }
                });
                console.log('✅ InitBoard broadcast edildi');
                
            } else if (data.type === 'move') {
                console.log('♟️ Hamle yapıldı: turn=', data.turn, 'pieces=', data.pieceList?.length || 0);
                
                // Game state'i güncelle - ÖNEMLİ: turn değerini client'tan al
                room.gameState.pieceList = data.pieceList || [];
                room.gameState.positionArray = data.positionArray || Array(8).fill().map(() => Array(8).fill(-1));
                room.gameState.movePath = data.movePath || [];
                room.gameState.turn = data.turn !== undefined ? data.turn : 0;
                room.gameState.firstTurnMove = data.firstTurnMove !== undefined ? data.firstTurnMove : true;
                room.gameState.simpleMoveMade = data.simpleMoveMade !== undefined ? data.simpleMoveMade : false;
                room.gameState.startedJumping = data.startedJumping !== undefined ? data.startedJumping : false;
                room.gameState.firstMovedPiece = data.firstMovedPiece || null;
                
                // Veritabanına kaydet
                await db.execute('UPDATE tables SET game_state = ? WHERE id = ?', 
                    [JSON.stringify(room.gameState), tableId]);
                
                // TÜM OYUNCULARA GÖNDER
                room.players.forEach(player => {
                    if (player.readyState === WebSocket.OPEN) {
                        const messageData = {
                            type: 'gameState',
                            pieceList: room.gameState.pieceList,
                            positionArray: room.gameState.positionArray,
                            turn: room.gameState.turn,
                            firstTurnMove: room.gameState.firstTurnMove,
                            simpleMoveMade: room.gameState.simpleMoveMade,
                            startedJumping: room.gameState.startedJumping,
                            firstMovedPiece: room.gameState.firstMovedPiece,
                            movePath: room.gameState.movePath
                        };
                        console.log('📤 Hamle broadcast: turn=', messageData.turn, 'pieces=', messageData.pieceList.length);
                        player.send(JSON.stringify(messageData));
                    }
                });

                // Kazanma kontrolü
                const blackPieces = room.gameState.pieceList.filter(p => p.col === 0).length;
                const whitePieces = room.gameState.pieceList.filter(p => p.col === 1).length;
                
                console.log(`🔢 Taş sayımı: Siyah=${blackPieces}, Beyaz=${whitePieces}`);
                
                if (blackPieces === 0 || whitePieces === 0) {
                    const winner = blackPieces === 0 ? 1 : 0;
                    const winnerColor = winner === 0 ? 'Siyah' : 'Beyaz';
                    console.log(`🏆 OYUN BİTTİ! Kazanan: ${winnerColor}`);
                    
                    room.players.forEach(player => {
                        if (player.readyState === WebSocket.OPEN) {
                            player.send(JSON.stringify({ 
                                type: 'gameEnd', 
                                winner,
                                winnerColor 
                            }));
                        }
                    });
                    
                    await db.execute('UPDATE tables SET status = "finished" WHERE id = ?', [tableId]);
                }
            }
        } catch (err) {
            console.error('❌ Mesaj işleme hatası:', err.message);
            console.error('Hatalı mesaj:', message.toString());
        }
    });

    // Bağlantı kapandı
    ws.on('close', async () => {
        console.log(`🔴 Bağlantı kapandı: tableId=${tableId}, isim=${ws.username || 'Bilinmeyen'}`);
        
        if (rooms.has(tableId)) {
            const room = rooms.get(tableId);
            const index = room.players.indexOf(ws);
            if (index !== -1) {
                room.players.splice(index, 1);
                delete room.playerColors[ws];
                delete room.playerNames[ws];
                console.log(`👋 Oyuncu ayrıldı: ${room.players.length} oyuncu kaldı`);
            }
            
            // Kalan oyunculara bildir
            if (room.players.length > 0) {
                room.players.forEach(player => {
                    if (player.readyState === WebSocket.OPEN) {
                        player.send(JSON.stringify({ type: 'opponentDisconnected' }));
                    }
                });
                await db.execute('UPDATE tables SET status = "open" WHERE id = ?', [tableId]);
            } else {
                // Hiç oyuncu kalmadıysa masayı sil
                await db.execute('DELETE FROM tables WHERE id = ?', [tableId]);
                rooms.delete(tableId);
                console.log(`🗑️ Masa silindi: tableId=${tableId}`);
            }
        }
    });

    ws.on('error', (err) => {
        console.error('❌ WebSocket hatası:', err.message);
    });
});

// Game state'i oyuncuya gönder
function sendGameStateToPlayer(player, room, tableId) {
    try {
        const gameState = room.gameState;
        const messageData = {
            type: 'gameState',
            pieceList: gameState.pieceList,
            positionArray: gameState.positionArray,
            turn: gameState.turn,
            firstTurnMove: gameState.firstTurnMove,
            simpleMoveMade: gameState.simpleMoveMade,
            startedJumping: gameState.startedJumping,
            firstMovedPiece: gameState.firstMovedPiece,
            movePath: gameState.movePath || []
        };
        
        console.log(`📤 State gönderiliyor: tableId=${tableId}, turn=${gameState.turn}, pieces=${gameState.pieceList?.length || 0}`);
        
        if (player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify(messageData));
        }
    } catch (err) {
        console.error('❌ State gönderme hatası:', err.message);
    }
}

console.log('🚀 Sunucu başlatıldı - http://localhost:8080');