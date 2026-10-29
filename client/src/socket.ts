import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getDeviceId(): string {
  let id = localStorage.getItem('allbot_device_id');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('allbot_device_id', id);
  }
  return id;
}

export function getDeviceName(): string {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const browser = navigator.userAgent.includes('Chrome')
    ? 'Chrome'
    : navigator.userAgent.includes('Safari')
    ? 'Safari'
    : navigator.userAgent.includes('Firefox')
    ? 'Firefox'
    : 'Browser';
  return `${isMobile ? 'Mobile' : 'Desktop'} (${browser})`;
}

export function initSocket(licenseKey: string = 'ALLBOT-CORP-DEV-2026'): Socket {
  const token = localStorage.getItem('allbot_auth_token') || '';

  if (socket) {
    if (socket.connected) return socket;
    socket.auth = {
      licenseKey,
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      token,
    };
    socket.connect();
    return socket;
  }

  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  socket = io(window.location.origin, {
    auth: {
      licenseKey,
      deviceId,
      deviceName,
      token,
    },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('[AllBot Socket Connected] Device ID:', deviceId);
  });

  socket.on('connect_error', (err) => {
    console.error('[AllBot Socket Error]', err.message);
  });

  // Kirim heartbeat setiap 30 detik agar server tahu device aktif
  setInterval(() => {
    if (socket?.connected) {
      socket.emit('heartbeat');
    }
  }, 30000);

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
