const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { pool, initDB } = require('./db');
const { router: authRouter, authenticate } = require('./auth');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadsDir));

const defaultClientUrls = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const clientOrigin = process.env.CLIENT_URL || defaultClientUrls;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || clientOrigin.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST']
};

const io = new Server(server, {
  cors: corsOptions
});

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  return res.json({
    url: `${serverUrl}/uploads/${req.file.filename}`,
    name: req.file.originalname,
  });
});

// Get all rooms
app.get('/api/rooms', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rooms ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get messages for a room (last 50)
app.get('/api/rooms/:roomId/messages', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.content, m.message_type, m.media_url, m.media_name, m.reply_to,
              m.forwarded_from, m.created_at, u.username, u.avatar_color,
              rm.content AS reply_content, ru.username AS reply_username
       FROM messages m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN messages rm ON m.reply_to = rm.id
       LEFT JOIN users ru ON rm.user_id = ru.id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC LIMIT 50`,
      [req.params.roomId]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.IO auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Track online users per room
const onlineUsers = new Map(); // roomId -> Set of usernames

io.on('connection', (socket) => {
  console.log(`🔌 ${socket.user.username} connected`);

  socket.on('join_room', (roomId) => {
    // Leave old rooms
    socket.rooms.forEach(r => {
      if (r !== socket.id) {
        socket.leave(r);
        if (onlineUsers.has(r)) {
          onlineUsers.get(r).delete(socket.user.username);
          io.to(r).emit('online_users', [...(onlineUsers.get(r) || [])]);
        }
      }
    });

    socket.join(roomId);
    if (!onlineUsers.has(roomId)) onlineUsers.set(roomId, new Set());
    onlineUsers.get(roomId).add(socket.user.username);
    io.to(roomId).emit('online_users', [...onlineUsers.get(roomId)]);
  });

  socket.on('send_message', async (payload) => {
    const {
      roomId,
      content = '',
      message_type = 'text',
      media_url = null,
      media_name = null,
      reply_to = null,
      forwarded_from = null,
    } = payload || {};

    if (!roomId) return;
    if (message_type === 'text' && !content?.trim()) return;

    try {
      const result = await pool.query(
        `INSERT INTO messages (room_id, user_id, content, message_type, media_url, media_name, reply_to, forwarded_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
        [roomId, socket.user.id, content || null, message_type, media_url, media_name, reply_to, forwarded_from]
      );

      let replyContent = null;
      let replyUsername = null;
      if (reply_to) {
        const replyRes = await pool.query(
          'SELECT m.content, u.username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
          [reply_to]
        );
        if (replyRes.rows[0]) {
          replyContent = replyRes.rows[0].content;
          replyUsername = replyRes.rows[0].username;
        }
      }

      const msg = {
        id: result.rows[0].id,
        content,
        message_type,
        media_url,
        media_name,
        reply_to,
        forwarded_from,
        reply_content: replyContent,
        reply_username: replyUsername,
        created_at: result.rows[0].created_at,
        username: socket.user.username,
        avatar_color: socket.user.avatar_color,
        room_id: roomId,
      };
      io.to(roomId).emit('new_message', msg);
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('user_typing', { username: socket.user.username, isTyping });
  });

  socket.on('disconnect', () => {
    onlineUsers.forEach((users, roomId) => {
      if (users.has(socket.user.username)) {
        users.delete(socket.user.username);
        io.to(roomId).emit('online_users', [...users]);
      }
    });
    console.log(`🔌 ${socket.user.username} disconnected`);
  });
});

initDB().then(() => {
  server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
