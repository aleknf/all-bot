document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const claudeStatus = document.getElementById('claudeStatus');
  const geminiStatus = document.getElementById('geminiStatus');
  const btnSync = document.getElementById('btnSync');
  const msgBox = document.getElementById('msgBox');

  // 1. Muat konfigurasi tersimpan
  const saved = await chrome.storage.local.get(['allbot_server_url', 'allbot_email', 'allbot_token']);
  if (saved.allbot_server_url) serverUrlInput.value = saved.allbot_server_url;
  if (saved.allbot_email) emailInput.value = saved.allbot_email;

  // 2. Deteksi Cookie di Browser saat ini
  let detectedClaudeKey = null;
  let detectedGeminiPSID = null;
  let detectedGeminiPSIDTS = null;

  try {
    const claudeCookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
    if (claudeCookie && claudeCookie.value) {
      detectedClaudeKey = claudeCookie.value;
      claudeStatus.textContent = '✓ Login Terdeteksi';
      claudeStatus.className = 'badge badge-ok';
    } else {
      claudeStatus.textContent = 'Belum Login';
      claudeStatus.className = 'badge badge-no';
    }
  } catch (e) {
    claudeStatus.textContent = 'Tidak dapat dibaca';
  }

  try {
    const geminiCookie = await chrome.cookies.get({ url: 'https://gemini.google.com', name: '__Secure-1PSID' }) 
      || await chrome.cookies.get({ url: 'https://google.com', name: '__Secure-1PSID' });
    
    if (geminiCookie && geminiCookie.value) {
      detectedGeminiPSID = geminiCookie.value;
      geminiStatus.textContent = '✓ Login Terdeteksi';
      geminiStatus.className = 'badge badge-ok';

      // Cek juga TS jika ada
      const tsCookie = await chrome.cookies.get({ url: 'https://gemini.google.com', name: '__Secure-1PSIDTS' })
        || await chrome.cookies.get({ url: 'https://google.com', name: '__Secure-1PSIDTS' });
      if (tsCookie) detectedGeminiPSIDTS = tsCookie.value;
    } else {
      geminiStatus.textContent = 'Belum Login';
      geminiStatus.className = 'badge badge-no';
    }
  } catch (e) {
    geminiStatus.textContent = 'Tidak dapat dibaca';
  }

  // 3. Eksekusi Sinkronisasi ke VPS
  btnSync.addEventListener('click', async () => {
    msgBox.style.display = 'none';
    btnSync.disabled = true;
    btnSync.innerHTML = '<span>⏳ Menyinkronkan ke VPS...</span>';

    const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      // Step A: Login ke AllBot untuk mendapatkan JWT Token
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        throw new Error(errData.error || `Gagal login ke server VPS (${loginRes.status})`);
      }

      const { token } = await loginRes.json();
      await chrome.storage.local.set({
        allbot_server_url: serverUrl,
        allbot_email: email,
        allbot_token: token,
      });

      // Step B: Kirim Kredensial yang terdeteksi ke VPS
      const payload = {
        claudeSessionKey: detectedClaudeKey || undefined,
        geminiSecure1PSID: detectedGeminiPSID || undefined,
        geminiSecure1PSIDTS: detectedGeminiPSIDTS || undefined,
      };

      const syncRes = await fetch(`${serverUrl}/api/license/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!syncRes.ok) {
        throw new Error(`Gagal menyimpan kredensial ke VPS (${syncRes.status})`);
      }

      // Berhasil
      msgBox.className = 'msg-box msg-success';
      msgBox.style.display = 'block';
      msgBox.innerHTML = `
        <strong>✓ Berhasil Tersambung!</strong><br/>
        ${detectedClaudeKey ? '• Claude Pro tersinkronisasi<br/>' : ''}
        ${detectedGeminiPSID ? '• Gemini Advanced tersinkronisasi<br/>' : ''}
        Semua device kini otomatis menggunakan sesi web ini.
      `;
    } catch (err) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.innerHTML = `<strong>Gagal:</strong> ${err.message}`;
    } finally {
      btnSync.disabled = false;
      btnSync.innerHTML = '<span>⚡ Sinkronkan ke VPS Sekarang</span>';
    }
  });
});
