import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

let socketInstance = null;

export const useSocket = (token) => {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    if (!socketInstance) {
      socketInstance = io('http://localhost:4000', { auth: { token } });
    }
    socketRef.current = socketInstance;
    return () => {};
  }, [token]);

  const joinRoom = useCallback((roomId) => {
    socketRef.current?.emit('join_room', roomId);
  }, []);

  const sendMessage = useCallback((roomId, contentOrPayload) => {
    if (!roomId) return;
    const payload = typeof contentOrPayload === 'string'
      ? { roomId, content: contentOrPayload }
      : { roomId, ...contentOrPayload };
    socketRef.current?.emit('send_message', payload);
  }, []);

  const sendTyping = useCallback((roomId, isTyping) => {
    socketRef.current?.emit('typing', { roomId, isTyping });
  }, []);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  return { joinRoom, sendMessage, sendTyping, on, socket: socketRef.current };
};
