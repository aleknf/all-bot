document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const btnTogglePwd = document.getElementById('btnTogglePwd');
  const rememberPasswordCheckbox = document.getElementById('rememberPassword');
  
  const authBanner = document.getElementById('authBanner');
  const authStatusText = document.getElementById('authStatusText');

  const claudeStatus = document.getElementById('claudeStatus');
  const geminiStatus = document.getElementById('geminiStatus');
  const btnSync = document.getElementById('btnSync');
  const msgBox = document.getElementById('msgBox');

  // Change Password elements
  const btnToggleChangePwd = document.getElementById('btnToggleChangePwd');
  const changePwdPanel = document.getElementById('changePwdPanel');
  const newPasswordInput = document.getElementById('newPassword');
  const btnChangePassword = document.getElementById('btnChangePassword');

  // 1. Muat konfigurasi tersimpan dari storage lokal ekstensi
  const saved = await chrome.storage.local.get([
    'allbot_server_url',
    'allbot_email',
    'allbot_password',
    'allbot_token',
    'allbot_remember',
  ]);

  // Fungsi pembuat default IP acak (dummy) agar tidak mengekspos IP server riil
  const generateRandomIpUrl = () => {
    const o1 = Math.floor(Math.random() * 180) + 20;
    const o2 = Math.floor(Math.random() * 254) + 1;
    const o3 = Math.floor(Math.random() * 254) + 1;
    const o4 = Math.floor(Math.random() * 254) + 1;
    return `http://${o1}.${o2}.${o3}.${o4}:4000`;
  };

  if (saved.allbot_server_url) {
    serverUrlInput.value = saved.allbot_server_url;
  } else {
    serverUrlInput.value = generateRandomIpUrl();
  }

  if (saved.allbot_email) {
    emailInput.value = saved.allbot_email;
  }

  if (saved.allbot_remember !== false) {
    rememberPasswordCheckbox.checked = true;
    if (saved.allbot_password) {
      passwordInput.value = saved.allbot_password;
    }
  } else {
    rememberPasswordCheckbox.checked = false;
  }

  // 2. Periksa status auth token yang tersimpan di server
  const checkCurrentAuth = async () => {
    const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    const token = saved.allbot_token;

    if (!token) {
      authBanner.className = 'auth-banner auth-need';
      authStatusText.textContent = '⚪ Masukkan password untuk update autentikasi';
      return null;
    }

    try {
      const res = await fetch(`${serverUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        authBanner.className = 'auth-banner auth-ok';
        authStatusText.textContent = `🟢 Terautentikasi: ${user.email} (${user.role})`;
        return token;
      } else {
        authBanner.className = 'auth-banner auth-need';
        authStatusText.textContent = '🟡 Sesi login kedaluwarsa — silakan input password baru';
        return null;
      }
    } catch (e) {
      authBanner.className = 'auth-banner auth-need';
      authStatusText.textContent = '🔴 Server belum terhubung — periksa URL & password';
      return null;
    }
  };

  await checkCurrentAuth();

  // 3. Toggle Lihat Password
  btnTogglePwd.addEventListener('click', () => {
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      btnTogglePwd.textContent = '🙈';
    } else {
      passwordInput.type = 'password';
      btnTogglePwd.textContent = '👁️';
    }
  });

  // 4. Deteksi Cookie Sesi di Browser saat ini
  let detectedClaudeKey = null;
  let detectedGeminiPSID = null;
  let detectedGeminiPSIDTS = null;

  try {
    const claudeCookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
    if (claudeCookie && claudeCookie.value) {
      detectedClaudeKey = claudeCookie.value;
      claudeStatus.textContent = `✓ Login Terdeteksi (${detectedClaudeKey.length} char)`;
      claudeStatus.className = 'badge badge-ok';
    } else {
      claudeStatus.textContent = 'Belum Login';
      claudeStatus.className = 'badge badge-no';
    }
  } catch (e) {
    claudeStatus.textContent = 'Tidak dapat dibaca';
  }

  try {
    const geminiCookie =
      (await chrome.cookies.get({ url: 'https://gemini.google.com', name: '__Secure-1PSID' })) ||
      (await chrome.cookies.get({ url: 'https://google.com', name: '__Secure-1PSID' }));

    if (geminiCookie && geminiCookie.value) {
      detectedGeminiPSID = geminiCookie.value;
      geminiStatus.textContent = `✓ Login Terdeteksi (${detectedGeminiPSID.length} char)`;
      geminiStatus.className = 'badge badge-ok';

      // Cek juga TS jika ada
      const tsCookie =
        (await chrome.cookies.get({ url: 'https://gemini.google.com', name: '__Secure-1PSIDTS' })) ||
        (await chrome.cookies.get({ url: 'https://google.com', name: '__Secure-1PSIDTS' }));
      if (tsCookie) detectedGeminiPSIDTS = tsCookie.value;
    } else {
      geminiStatus.textContent = 'Belum Login';
      geminiStatus.className = 'badge badge-no';
    }
  } catch (e) {
    geminiStatus.textContent = 'Tidak dapat dibaca';
  }

  // 5. Eksekusi Login / Update Auth & Sinkronkan ke Website VPS
  btnSync.addEventListener('click', async () => {
    msgBox.style.display = 'none';
    const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.textContent = 'Email wajib diisi.';
      return;
    }

    if (!password) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.textContent = 'Password website wajib diisi untuk melakukan update auth.';
      return;
    }

    btnSync.disabled = true;
    btnSync.innerHTML = '<span>⏳ Mengautentikasi & Menyinkronkan...</span>';

    try {
      // Step A: Login ke AllBot untuk mendapatkan JWT Auth Token terbaru
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        throw new Error(errData.error || `Login website gagal (${loginRes.status}). Periksa password.`);
      }

      const { token, user } = await loginRes.json();

      // Simpan konfigurasi ke storage ekstensi
      await chrome.storage.local.set({
        allbot_server_url: serverUrl,
        allbot_email: email,
        allbot_token: token,
        allbot_remember: rememberPasswordCheckbox.checked,
        allbot_password: rememberPasswordCheckbox.checked ? password : '',
      });

      // Update badge banner
      authBanner.className = 'auth-banner auth-ok';
      authStatusText.textContent = `🟢 Terautentikasi: ${user?.email || email}`;

      // Step B: Kirim Kredensial Web (Cookie) yang terdeteksi ke Website VPS
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
        const syncErr = await syncRes.json().catch(() => ({}));
        throw new Error(syncErr.error || `Gagal menyimpan cookie ke VPS (${syncRes.status})`);
      }

      // Berhasil
      msgBox.className = 'msg-box msg-success';
      msgBox.style.display = 'block';
      msgBox.innerHTML = `
        <strong>✓ Auth Website & Cookie Berhasil Diperbarui!</strong><br/>
        • Akun: <code>${email}</code> (Auth aktif)<br/>
        ${detectedClaudeKey ? '• Sesi Claude Pro tersimpan di server<br/>' : '• Claude Pro: belum login di browser ini<br/>'}
        ${detectedGeminiPSID ? '• Sesi Gemini Advanced tersimpan di server<br/>' : '• Gemini: belum login di browser ini<br/>'}
        <span style="display:inline-block; margin-top:4px; color:#86efac;">Seluruh agen AI di website AllBot siap digunakan.</span>
      `;
    } catch (err) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.innerHTML = `<strong>Gagal:</strong> ${err.message}`;
    } finally {
      btnSync.disabled = false;
      btnSync.innerHTML = '<span>⚡ Update Auth & Sinkronkan ke Website</span>';
    }
  });

  // 6. Accordion Ganti Password Website
  btnToggleChangePwd.addEventListener('click', () => {
    if (changePwdPanel.style.display === 'block') {
      changePwdPanel.style.display = 'none';
    } else {
      changePwdPanel.style.display = 'block';
    }
  });

  // 7. Eksekusi Ganti Password di Website Server
  btnChangePassword.addEventListener('click', async () => {
    msgBox.style.display = 'none';
    const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
    const email = emailInput.value.trim();
    const currentPassword = passwordInput.value;
    const newPassword = newPasswordInput.value;

    if (!currentPassword) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.textContent = 'Masukkan password saat ini pada kolom Password Website di atas.';
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.textContent = 'Password baru minimal 6 karakter.';
      return;
    }

    btnChangePassword.disabled = true;
    btnChangePassword.textContent = 'Mengubah password...';

    try {
      // Pastikan login terlebih dahulu dengan password saat ini
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: currentPassword }),
      });

      if (!loginRes.ok) {
        throw new Error('Password saat ini tidak sesuai.');
      }

      const { token } = await loginRes.json();

      // Panggil endpoint change-password
      const changeRes = await fetch(`${serverUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          oldPassword: currentPassword,
          newPassword: newPassword,
        }),
      });

      if (!changeRes.ok) {
        const errData = await changeRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal mengubah password di server.');
      }

      // Berhasil: update passwordInput ke password baru
      passwordInput.value = newPassword;
      newPasswordInput.value = '';
      changePwdPanel.style.display = 'none';

      // Simpan password baru ke storage jika remember aktif
      if (rememberPasswordCheckbox.checked) {
        await chrome.storage.local.set({ allbot_password: newPassword });
      }

      msgBox.className = 'msg-box msg-success';
      msgBox.style.display = 'block';
      msgBox.innerHTML = '<strong>✓ Password Website Berhasil Diperbarui!</strong><br/>Password login website Anda kini telah berganti.';
    } catch (err) {
      msgBox.className = 'msg-box msg-error';
      msgBox.style.display = 'block';
      msgBox.innerHTML = `<strong>Gagal:</strong> ${err.message}`;
    } finally {
      btnChangePassword.disabled = false;
      btnChangePassword.textContent = 'Perbarui Password ke Website Server';
    }
  });
});
