# AllBot - Multi-Agent & Omni-Channel Workspace

Aplikasi web terpadu untuk mengelola berbagai agen AI dan channel obrolan, dengan dukungan **sinkronisasi multi-perangkat real-time** di bawah **satu model lisensi yang sama** melalui internet publik.

---

## ✨ Fitur Utama

1. **Multi-Agent Studio**:
   - Buat dan kelola agen AI dengan persona kustom, system prompt, pengaturan temperature, dan pilihan model (Google Gemini, Claude, OpenAI).
   - Agen dapat ditugaskan ke satu atau beberapa channel sekaligus.

2. **Omni-Channel Web Architecture (Tanpa WA)**:
   - **Internal Rooms**: Ruang obrolan tim untuk kolaborasi manusia dan agen AI.
   - **Public Web Link**: Tautan obrolan yang dapat dibuka oleh siapa saja di browser untuk berinteraksi dengan agen yang bertugas.
   - **Direct Copilot**: Ruang chat privat 1-on-1 dengan agen spesifik.

3. **Multi-Device Real-Time Sync**:
   - Berjalan murni di atas **WebSocket (Socket.io)**.
   - Obrolan di Laptop (Device 1) langsung muncul di HP/Tablet (Device 2) secara instan tanpa delay.

4. **Model Lisensi Terpadu (Seat-Based Licensing)**:
   - Satu *Master License Key* menaungi seluruh perangkat tim.
   - Dilengkapi dashboard monitor perangkat aktif (Device Name, Device ID, IP, Last Active).
   - Fitur *Revoke/Kick* perangkat untuk membebaskan kuota seat secara langsung.

5. **Agen dengan Tool, Subagen Paralel & MCP** *(Pengaturan Lanjutan → ikon kunci inggris di sidebar)*:
   - Agen yang diberi provider bisa memanggil tool: waktu, kalkulator aman, `web_fetch` (alamat internal diblokir), memori, dan `run_subagents` untuk mengerjakan beberapa tugas independen **secara paralel**.
   - **MCP**: sambungkan server MCP remote (HTTP/SSE); tool-nya otomatis tersedia untuk agen dengan tool aktif. Transport `stdio` mati secara default (set `ALLOW_MCP_STDIO=true` bila memang perlu).

6. **Provider LLM Fleksibel**: Nous Portal, OpenRouter, OpenAI, atau endpoint OpenAI-compatible kustom (mis. Ollama). Provider dan nama model dipilih per agen dari UI, tanpa mengubah kode. Jalur lama (cookie Claude/Gemini web) tetap berjalan untuk agen tanpa provider.
   - **Claude CLI (langganan)**: menjalankan Claude Code CLI resmi di server dengan token dari `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN` di `.env`). Semua tool CLI dimatikan; cepat dan tanpa pembatasan laju cookie claude.ai.

7. **Scheduler Cron**: jalankan prompt otomatis (cron 5 kolom + zona waktu), hasilnya diposting ke channel.

8. **Memori Lintas Sesi**: fakta jangka panjang ikut terbawa ke semua channel dan sesi; disimpan agen lewat `memory_save` atau ditambah manual dari UI.

> Pengaturan provider, MCP, dan jadwal hanya bisa diubah oleh user ber-role `ADMIN`.

---

## 🚀 Cara Menjalankan

### Opsi A: Mode Development (Lokal)
Dari folder root `/Users/aleknurfatman/Downloads/alek/all-bot`:

```bash
npm run dev
```
Buka browser di `http://localhost:3000`.

---

### Opsi B: Deploy ke VPS Personal (Docker Compose)

Di VPS Anda, jalankan satu perintah:

```bash
docker compose up -d --build
```

Setelah selesai, aplikasi langsung aktif di port `4000`:
* Buka browser: `http://IP_VPS_ANDA:4000`
* Frontend web dan WebSocket otomatis tersaji dari satu port tunggal.
* Database tersimpan aman di volume `allbot_data`.

Untuk melihat log kontainer:
```bash
docker compose logs -f
```

Untuk mematikan:
```bash
docker compose down
```

---

## 📱 Cara Menghubungkan Perangkat Kedua (HP / Laptop Lain)

1. Pastikan server sudah berjalan.
2. Untuk akses dari HP dalam jaringan Wi-Fi yang sama:
   - Cari IP lokal laptop Anda (misal: `http://192.168.1.50:3000`).
   - Buka alamat tersebut di Safari/Chrome HP Anda.
3. Untuk akses via internet publik:
   - Gunakan Cloudflare Tunnel (`cloudflared tunnel`) atau ngrok:
     ```bash
     npx ngrok http 3000
     ```
   - Buka link publik tersebut dari perangkat manapun.
4. Perangkat baru akan otomatis terdaftar di bawah lisensi yang sama dan dapat dipantau melalui menu **Pengaturan Lisensi & Perangkat** di pojok kiri bawah.

---

## 🔑 Konfigurasi API LLM (Opsional)

Secara default, AllBot sudah dilengkapi fallback cerdas sehingga dapat langsung dipakai chat tanpa API key. Untuk mengaktifkan kecerdasan penuh dari Google Gemini atau OpenAI, buka file `server/.env` dan isi:

```env
GEMINI_API_KEY="AIzaSy..."
OPENAI_API_KEY="sk-..."
```
