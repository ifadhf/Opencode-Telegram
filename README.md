# Opencode-Telegram

Bot Telegram untuk mengontrol [OpenCode](https://opencode.ai) dari Telegram — dengan dukungan forum topics (multi-sesi paralel), voice message transcription, history berpaginasi, dan notifikasi real-time.

Fork dari [vineetkishore01/Opencode-Telegram](https://github.com/vineetkishore01/Opencode-Telegram) dengan lapisan UX ala ccbot — backend API OpenCode (HTTP + SSE), bukan tmux.

## ✨ Features

- **Local-First** — semua berjalan di mesin lokal, tidak ada cloud/tunnel
- **Forum Topics / Multi-Sesi** — 1 topic = 1 sesi OpenCode, bisa paralel di project berbeda
- **Voice Message → Transkrip** — kirim voice note, otomatis ditranskrip via OpenAI Whisper, lanjut sebagai prompt
- **History Berpaginasi** — `/history` dengan inline keyboard `◀ Older / Newer ▶`, 5 pesan per halaman
- **Notifikasi Real-time** — SSE-based event streaming, ringkasan tool, thinking blockquote (flag-based)
- **Permission Handling** — approve/reject via tombol inline (Once/Always/Reject)
- **Session Management** — create, list, switch, continue session
- **Model & Mode Selection** — pilih provider, model, mode (build/plan) per-sesi
- **Message Queueing** — antrikan prompt saat OpenCode sibuk
- **File Operations** — `/files` list, `/file` view, `/find` search
- **Cost Tracking** — `/cost` monitor token usage per sesi
- **Health Monitor** — auto-deteksi crash server OpenCode + restart otomatis

## 🚀 Quick Start

### Prasyarat

- [Node.js](https://nodejs.org/) ≥ 18
- [OpenCode](https://opencode.ai) CLI: `npm install -g opencode-ai`
- Akun Telegram
- (Opsional untuk voice) OpenAI API key

### Setup

```bash
git clone https://github.com/ifadhf/Opencode-Telegram.git
cd Opencode-Telegram
npm install
npm run build
```

### Konfigurasi

Salin `.env.example` ke `.env`:

```bash
cp .env.example .env
```

Isi minimal:

```env
TELEGRAM_BOT_TOKEN=123:abc
AUTHORIZED_USER_ID=456
```

Variable lengkap — lihat [.env.example](.env.example).

### Jalankan

```bash
npm run dev              # development (tsx, hot-reload)
npm run build && npm start  # production build
```

Atau via CLI:

```bash
opencode-tele -d /path/to/project
opencode-tele -d /path/to/project -p 5000
opencode-tele --no-server   # connect ke OpenCode server yang sudah jalan
```

---

## 📋 Commands

### Session & Project

| Command | Deskripsi |
|---|---|
| `/session` | Buat sesi baru / lihat sesi aktif |
| `/sessions` | List sesi terbaru |
| `/continue` | Lanjutkan sesi lama (pilih dari list) |
| `/clear` | Hapus sesi & setting saat ini |
| `/newtopic` | Buat sesi baru di forum topic (dengan directory browser) |
| `/status` | Lihat status sesi (ID, model, mode, cwd) |
| `/working` | Lihat apa yang sedang dikerjakan OpenCode |
| `/abort` | Hentikan task yang sedang berjalan |

### Model & Mode

| Command | Deskripsi |
|---|---|
| `/providers` | List AI provider |
| `/models` | List model untuk provider |
| `/model` | Pilih / lihat model saat ini |
| `/modes` | List mode yang tersedia |
| `/mode` | Pilih mode (build / plan) |

### Files & Code

| Command | Deskripsi |
|---|---|
| `/files` | List file project |
| `/file <path>` | Lihat isi file |
| `/find <query>` | Search kode |

### History & Voice

| Command | Deskripsi |
|---|---|
| `/history [page]` | Lihat riwayat pesan sesi (5/halaman, inline nav) |
| `:voice` (voice note) | Kirim voice note → transkrip → prompt |

### Info & Utility

| Command | Deskripsi |
|---|---|
| `/start` | Welcome message |
| `/help` | List semua command |
| `/cost` | Lihat token usage & cost |
| `/todo` | Lihat task list OpenCode |
| `/diff` | Lihat file changes |

---

## 🎛️ Feature Flags

Kontrol verbositas notifikasi via environment variable. Semua default `false` (quiet mode):

| Flag | Default | Efek |
|---|---|---|
| `SHOW_TOOL_CALLS` | `false` | Tampilkan tiap tool call sebagai notifikasi terpisah |
| `SHOW_THINKING` | `false` | Tampilkan reasoning text sebagai blockquote |
| `SHOW_TOKENS` | `false` | Tampilkan token usage di notifikasi completion |

```env
SHOW_TOOL_CALLS=true
SHOW_THINKING=true
SHOW_TOKENS=true
```

---

## 🧵 Forum Topics (Multi-Sesi)

Bot mendukung Telegram forum topics — setiap topic bisa punya sesi OpenCode sendiri di project berbeda.

**Setup:**
1. Buat group Telegram → `Group Type = Forum`
2. Invite bot sebagai **admin**
3. Di topic baru, kirim `/newtopic` → pilih directory dari inline keyboard
4. Prompt berikutnya otomatis terikat ke sesi topic tersebut

**Perilaku:**
- Setiap topic punya sesi, model, mode, dan cwd independen
- Notifikasi tidak tertukar antar topic
- `/status`, `/clear`, `/abort`, `/model`, `/mode` semua sadar topic
- Topic dihapus → binding dilepas otomatis

---

## 🎤 Voice Messages

Kirim voice note langsung ke bot — akan ditranskrip via OpenAI Whisper API, lalu diteruskan sebagai prompt.

**Prasyarat:**
```env
OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1  # opsional
```

Voice message mengikuti flow yang sama dengan teks: resolve sesi → transkrip → kirim prompt → queue jika busy.

---

## 🚢 Deployment (systemd)

Deploy sebagai systemd user service (pola sama seperti ccbot):

```bash
# 1. Clone ke /opt
sudo mkdir -p /opt/opencode-telegram
sudo chown $USER:$USER /opt/opencode-telegram
git clone https://github.com/ifadhf/Opencode-Telegram.git /opt/opencode-telegram
cd /opt/opencode-telegram
npm install && npm run build

# 2. Copy .env
cp .env.example .env
# edit .env dengan token & user ID

# 3. Buat systemd user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/opencode-tele.service << 'EOF'
[Unit]
Description=opencode-tele - Telegram bridge for OpenCode
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/opencode-telegram
Environment=PATH=/home/USER/.nvm/versions/node/v20/bin:/home/USER/.opencode/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/USER/.nvm/versions/node/v20/bin/node /opt/opencode-telegram/dist/index.js -d /path/to/your/project
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

# 4. Enable & start
systemctl --user daemon-reload
systemctl --user enable --now opencode-tele

# 5. Enable linger (supaya tetap jalan setelah logout)
loginctl enable-linger
```

**Command berguna:**
```bash
systemctl --user status opencode-tele
journalctl --user -u opencode-tele -f
systemctl --user restart opencode-tele
```

---

## 🔧 Environment Variables

| Variable | Required | Default | Deskripsi |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token bot dari @BotFather |
| `AUTHORIZED_USER_ID` | ✅ | — | Telegram user ID |
| `OPENCODE_SERVER_URL` | ❌ | `http://127.0.0.1:4097` | URL server OpenCode |
| `OPENCODE_SERVER_USERNAME` | ❌ | — | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | ❌ | — | Basic auth password |
| `OPENAI_API_KEY` | ❌* | — | API key OpenAI (wajib untuk voice) |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | Custom OpenAI-compatible endpoint |
| `SHOW_TOOL_CALLS` | ❌ | `false` | Tampilkan tool call notif |
| `SHOW_THINKING` | ❌ | `false` | Tampilkan reasoning text |
| `SHOW_TOKENS` | ❌ | `false` | Tampilkan token usage |
| `LOG_LEVEL` | ❌ | `debug` | `debug` / `info` / `warn` / `error` |

---

## 🧪 Testing

```bash
# TDD contracts (dari folder Opencode-Telegram)
node --test test/f2/prereq-api.mjs test/f2/state-contract.mjs
node --test test/f3/prereq-api.mjs test/f3/voice-contract.mjs test/f3/history-contract.mjs
node --test test/f4/prereq-api.mjs test/f4/health-contract.mjs test/f4/config-contract.mjs

# Typecheck
npm run typecheck
```

---

## 🔗 Referensi

- [OpenCode](https://opencode.ai) — backend AI agent
- [grammY](https://grammy.dev) — framework Telegram bot
- [ccbot](https://github.com/six-ddc/ccbot) — acuan UX (Telegram ↔ Claude Code)
- Upstream: [vineetkishore01/Opencode-Telegram](https://github.com/vineetkishore01/Opencode-Telegram)
