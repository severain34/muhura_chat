import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';

const Avatar = ({ username, color, size = 36 }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%',
    background: color || '#6366f1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: size * 0.4,
    flexShrink: 0,
  }}>
    {username?.[0]?.toUpperCase()}
  </div>
);

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const { joinRoom, sendMessage, sendTyping, on } = useSocket(token);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [replyTo, setReplyTo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    axios.get('/api/rooms').then(res => {
      setRooms(res.data);
      if (res.data.length > 0) setActiveRoom(res.data[0]);
    });
  }, []);

  useEffect(() => {
    if (!activeRoom) return;
    joinRoom(activeRoom.id);
    axios.get(`/api/rooms/${activeRoom.id}/messages`).then(res => setMessages(res.data));
    setTypingUsers([]);
  }, [activeRoom, joinRoom]);

  useEffect(() => {
    const offMsg = on('new_message', (msg) => setMessages(prev => [...prev, msg]));
    const offOnline = on('online_users', (users) => setOnlineUsers(users));
    const offTyping = on('user_typing', ({ username, isTyping }) => {
      setTypingUsers(prev =>
        isTyping ? [...new Set([...prev, username])] : prev.filter(u => u !== username)
      );
    });
    return () => { offMsg?.(); offOnline?.(); offTyping?.(); };
  }, [on]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const groupMessages = (msgs) => {
    const grouped = [];
    msgs.forEach((msg, i) => {
      const prev = msgs[i - 1];
      const sameUser = prev?.username === msg.username;
      const sameMinute = prev && Math.abs(new Date(msg.created_at) - new Date(prev.created_at)) < 60000;
      grouped.push({ ...msg, grouped: sameUser && sameMinute });
    });
    return grouped;
  };

  const sendTextMessage = async (payload) => {
    if (!activeRoom) return;
    sendMessage(activeRoom.id, payload);
    setReplyTo(null);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || !activeRoom) return;
    sendTextMessage({ content: input.trim(), reply_to: replyTo?.id || null });
    setInput('');
    setReplyTo(null);
    sendTyping(activeRoom.id, false);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    sendTyping(activeRoom?.id, true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => sendTyping(activeRoom?.id, false), 1500);
  };

  const uploadFile = async (file, messageType) => {
    if (!file || !activeRoom) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      sendTextMessage({
        message_type: messageType,
        media_url: res.data.url,
        media_name: res.data.name,
        reply_to: replyTo?.id || null,
      });
      setReplyTo(null);
    } catch (err) {
      console.error('Upload failed', err);
    }
  };

  const handleUpload = (event, type) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (type === 'image') {
      uploadFile(file, 'image');
    } else {
      uploadFile(file, 'file');
    }
    event.target.value = '';
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError('Audio recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        await uploadFile(file, 'audio');
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      setRecording(true);
      setRecordingError('');
    } catch (err) {
      setRecordingError('Unable to record audio. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      setRecording(false);
    }
  };

  const toggleRecording = () => {
    if (recording) stopRecording(); else startRecording();
  };

  const handleForward = (msg) => {
    if (!activeRoom) return;
    sendMessage(activeRoom.id, {
      message_type: msg.message_type,
      content: msg.content,
      media_url: msg.media_url,
      media_name: msg.media_name,
      forwarded_from: msg.username,
    });
  };

  return (
    <div className="chat-app">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <span className="brand-text">📚 StudyChat</span>
          <button className="toggle-btn" onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? '←' : '→'}
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-label">ROOMS</div>
          {rooms.map(room => (
            <button
              key={room.id}
              className={`room-btn ${activeRoom?.id === room.id ? 'active' : ''}`}
              onClick={() => setActiveRoom(room)}
            >
              <span className="room-hash">#</span>
              <span className="room-name">{room.name}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="section-label">ONLINE — {onlineUsers.length}</div>
          {onlineUsers.map(u => (
            <div key={u} className="online-user">
              <span className="online-dot" />
              <span>{u}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <Avatar username={user?.username} color={user?.avatar_color} size={32} />
          <span className="footer-username">{user?.username}</span>
          <button className="logout-btn" onClick={logout} title="Logout">⏻</button>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-header">
          <div className="header-room">
            <span className="header-hash">#</span>
            <span>{activeRoom?.name || 'Select a room'}</span>
          </div>
          {activeRoom?.description && <span className="header-desc">{activeRoom.description}</span>}
        </header>

        <div className="messages-area">
          {groupMessages(messages).map(msg => (
            <div key={msg.id} className={`message ${msg.grouped ? 'grouped' : ''} ${msg.username === user?.username ? 'own' : ''}`}>
              {!msg.grouped && (
                <div className="msg-header">
                  <Avatar username={msg.username} color={msg.avatar_color} size={32} />
                  <span className="msg-username">{msg.username}</span>
                  <span className="msg-time">{formatTime(msg.created_at)}</span>
                </div>
              )}
              <div className={`msg-body ${msg.grouped ? 'msg-body-grouped' : ''}`}>
                <div className="msg-bubble">
                  {msg.reply_to && (
                    <div className="reply-preview">
                      <span className="reply-label">Replying to {msg.reply_username || 'Unknown'}:</span>
                      <span>{msg.reply_content || msg.media_name || 'Media message'}</span>
                    </div>
                  )}

                  {msg.forwarded_from && <div className="forward-label">Forwarded from {msg.forwarded_from}</div>}

                  {msg.message_type === 'image' && msg.media_url ? (
                    <img className="media-image" src={msg.media_url} alt={msg.media_name || 'Image'} />
                  ) : msg.message_type === 'audio' && msg.media_url ? (
                    <audio className="media-audio" controls src={msg.media_url} />
                  ) : msg.message_type === 'file' && msg.media_url ? (
                    <a className="media-file" href={msg.media_url} download={msg.media_name}>
                      📎 {msg.media_name || 'Download file'}
                    </a>
                  ) : (
                    <div>{msg.content}</div>
                  )}
                </div>
                <div className="message-actions">
                  <button type="button" onClick={() => setReplyTo(msg)}>Reply</button>
                  <button type="button" onClick={() => handleForward(msg)}>Forward</button>
                </div>
              </div>
            </div>
          ))}

          {typingUsers.length > 0 && (
            <div className="typing-indicator">
              <span className="typing-dots"><span/><span/><span/></span>
              <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="composer-panel">
          {replyTo && (
            <div className="replying-banner">
              Replying to <strong>{replyTo.username}</strong>: {replyTo.content || replyTo.media_name || 'Media message'}
              <button type="button" onClick={() => setReplyTo(null)}>✕</button>
            </div>
          )}

          <div className="composer-actions">
            <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={(e) => handleUpload(e, 'image')} />
            <input type="file" style={{ display: 'none' }} ref={attachmentInputRef} onChange={(e) => handleUpload(e, 'file')} />
            <button type="button" className="action-btn" onClick={() => fileInputRef.current?.click()}>🖼️</button>
            <button type="button" className="action-btn" onClick={() => attachmentInputRef.current?.click()}>📎</button>
            <button type="button" className={`action-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording}>
              {recording ? '⏹️' : '🎙️'}
            </button>
            <span className="action-label">{recording ? 'Recording voice clip...' : 'Upload image/file or record voice'}</span>
          </div>

          {recordingError && <div className="recording-error">{recordingError}</div>}

          <form className="message-form" onSubmit={handleSend}>
            <input
              className="message-input"
              value={input}
              onChange={handleInputChange}
              placeholder={`Message #${activeRoom?.name || '...'}`}
              disabled={!activeRoom}
              autoFocus
            />
            <button type="submit" className="send-btn" disabled={!input.trim() && !replyTo}>
              ➤
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
