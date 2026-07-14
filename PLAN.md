# Development Plan — Opencode-Telegram (fork `ifadhf`)

> **Tujuan:** pengalaman Telegram ala [ccbot](https://github.com/six-ddc/ccbot) (Claude Code) — notifikasi real-time yang rapi, multi-sesi via forum topics, voice message, riwayat berpaginasi — tetapi dengan backend **OpenCode** (HTTP + SSE).
>
> Upstream: [vineetkishore01/Opencode-Telegram](https://github.com/vineetkishore01/Opencode-Telegram) v0.2.3 · TypeScript + grammY · Node ≥ 18
> Fork dibuat: 2026-07-13. Dokumen ini living document — update checkbox seiring progress.

## 1. Kenapa fork dari Opencode-Telegram, bukan dari ccbot?

Bagian tersulit ccbot adalah integrasi backend-nya, dan seluruhnya spesifik Claude Code:

| Modul ccbot | Terikat Claude Code karena… |
|---|---|
| `tmux_manager.py` | kontrol lewat tmux window (Claude Code = TUI interaktif) |
| `session_monitor.py` + `transcript_parser.py` | polling transcript `~/.claude/projects/*.jsonl` |
| `terminal_parser.py` | scraping pane terminal (permission prompt, plan mode, status line) |
| `hook.py` | hook `SessionStart` milik Claude Code |

OpenCode tidak bekerja seperti itu — ia menyediakan **HTTP server + SSE event stream** (API programatik). Fork dari ccbot berarti membuang ±80% inti aplikasi dan menulis ulang terhadap API OpenCode. Sebaliknya, repo ini sudah punya integrasi yang benar:

- `src/opencode/client.ts` — HTTP client + SSE (`/prompt_async`, `/event`)
- `src/opencode/events.ts` — event processor SSE → notifikasi Telegram
- `src/opencode/permission.ts` — approve/reject via inline keyboard (Once/Always/Reject)
- `src/opencode/server.ts` — lifecycle server OpenCode (auto start/stop)

Yang kurang hanyalah **lapisan UX** — kerja aditif di atas fondasi yang benar.

**Trade-off yang disadari:** kontinuitas desktop↔HP ala tmux (keunggulan khas ccbot) tidak ikut. Pada model API, sesi disimpan server-side oleh OpenCode, jadi kontinuitas tetap mungkin (buka TUI `opencode` pada project/sesi yang sama) — mekanismenya saja yang berbeda.

## 2. Gap analysis (pengalaman ccbot vs kondisi upstream)

| Fitur khas ccbot | Status di upstream | Aksi |
|---|---|---|
| Approve/reject permission via tombol | ✅ ada (`permission.ts`) | poles |
| AskUserQuestion / MCQ via tombol | ✅ ada (`question` tool) | poles |
| Plan mode | ✅ setara `/mode plan` | mapping UX |
| Notifikasi real-time (teks, thinking, tool use/result) | 🟡 sebagian (`events.ts`) | Fase 1 |
| Notif "✅ task selesai — menunggu input" (+debounce) | ❌ | Fase 1 |
| **Forum topics: 1 topic = 1 sesi, paralel** | ❌ (single chat) | **Fase 2 — gap terbesar** |
| Voice message → transkrip | ❌ | Fase 3 |
| Riwayat pesan berpaginasi | ❌ | Fase 3 |
| Directory browser untuk sesi baru | ❌ (pakai flag `-d`) | Fase 2/4 |
| Screenshot terminal | ❌ | non-goal (tidak ada TUI) |

## 3. Fase pengembangan

### Fase 0 — Fondasi & baseline (~½ hari)

- [x] Clone fork lokal, `npm install`, `npm run build`, `npm run typecheck`
- [x] Install backend: `npm i -g opencode-ai` (pin versi, catat di README)
- [x] Buat bot uji via @BotFather, jalankan `opencode-tele` end-to-end di project dummy
- [x] Catat baseline: format pesan sekarang, perilaku command, event SSE yang benar-benar diterima
- [x] Setup remote: `origin` = fork ini, `upstream` = vineetkishore01 (untuk sync)
- [ ] (Opsional) rebranding `opencode-tele` → nama baru (kandidat: `ocbot`) — ditunda

**Selesai jika:** prompt dari Telegram dijawab OpenCode end-to-end di mesin dev. ✅ (2026-07-13, 5/5 test PASS)

### Fase 1 — Poles notifikasi + completion notif (1–2 hari) — quick win

- [x] `events.ts`: ringkasan tool ala ccbot ("Read 42 lines", "Found 5 matches", `❯ command`)
- [x] Thinking sebagai expandable blockquote, flag `SHOW_THINKING` (default off)
- [x] Flag `SHOW_TOOL_CALLS` (default off) — hindari flood limit Telegram (~20 msg/menit/grup)
- [x] Flag `SHOW_TOKENS` (default off) — tampilkan usage token di notif completion, format: `65→80 tokens (19 reasoning) [cache: 20224r/0w]`
- [x] Notif completion + debounce ±5 dtk: "✅ Selesai — menunggu input" (port perilaku dari patch ccbot)
- [x] Splitting pesan panjang yang sadar tag HTML / code block

**Selesai jika:** task panjang menghasilkan sedikit pesan yang rapi + tepat satu notif completion. ✅ (2026-07-14, human test 9/9 PASS)

### Fase 2 — Forum topics / multi-sesi (3–5 hari) — jantung UX ccbot

- [x] **Riset topologi server** (keputusan desain terbesar): 1 server OpenCode per project-dir (pool port) vs 1 server multi-directory (cek dukungan API OpenCode untuk directory per-request/per-session)
- [x] `state/manager.ts`: peta `topic_id ↔ {session_id, cwd, model, mode}` persisten
- [x] `handlers.ts`: routing pesan & notifikasi per `message_thread_id`
- [x] Topic baru → directory browser (inline keyboard) → buat/resume sesi
- [x] Topic ditutup/dihapus → lepas binding (+ tangani error "Message thread not found")
- [x] `/status` per-topic (sesi, model, mode, cwd)

**Selesai jika:** 2 topic berjalan paralel di 2 project berbeda, notifikasi tidak tertukar.

### Fase 3 — Voice & riwayat (2–3 hari)

- [x] Voice note: unduh OGG dari Telegram → transkrip via API OpenAI-compatible (`OPENAI_API_KEY` + `OPENAI_BASE_URL`) → forward sebagai prompt
- [x] `/history`: baca pesan sesi dari API OpenCode, paginasi inline `◀ Older / Newer ▶` (terbaru dulu)

### Fase 4 — Poles & deploy (1–2 hari)

- [x] README tulis ulang (fitur baru, setup forum topics, daftar flag)
- [x] `.env.example` lengkap
- [x] Health monitor: crash detection & auto-restart OpenCode server (`src/opencode/health.ts`)
- [x] Config hardening: `validateFeatureFlags()` + improved validation messages
- [x] Deploy: `/opt/<nama>` + systemd user service + linger (pola sama dengan deployment ccbot)
- [x] Uji stabilitas produksi: restart daemon, reconnect SSE, server OpenCode mati/naik lagi

## 4. Non-goals

- Screenshot terminal — backend-nya API, tidak ada TUI untuk di-screenshot
- Multi-tenant / multi-user — tetap single authorized user
- Integrasi tmux

## 5. Risiko & catatan teknis

- **Flood limit Telegram** (~20 pesan/menit/grup) → debounce, merge pesan, flag `SHOW_*` default hemat
- **Stabilitas API OpenCode** — pin versi `opencode-ai`; skema event SSE bisa berubah antar rilis
- **Topologi multi-project** — riset dulu sebelum koding Fase 2; jangan asumsikan 1 server bisa lintas direktori
- **Forum topics** — bot harus admin di grup ber-topics; deteksi topic terhapus tidak selalu andal

## 6. Referensi

- Upstream: https://github.com/vineetkishore01/Opencode-Telegram
- ccbot (acuan UX): https://github.com/six-ddc/ccbot
- OpenCode: https://opencode.ai/docs (npm: `opencode-ai`)
- grammY: https://grammy.dev

## 7. Progress log

| Tanggal | Progress |
|---|---|
| 2026-07-13 | Fork dibuat, development plan disusun |
| 2026-07-13 | Fase 0 selesai: build/typecheck OK, bot uji e2e, 2 bug relay diperbaiki (`37d1b7b`), 5/5 test PASS |
| 2026-07-13 | Fase 1 selesai: tool summaries, SHOW_THINKING/SHOW_TOOL_CALLS/SHOW_TOKENS flags, completion debounce 5dtk, HTML-aware splitting (`b66c3f1`) |
| 2026-07-14 | Service `opencode-tele.service` di-restart untuk memuat kode F1; dokumentasi disinkronkan; test script F2 (AI-agent) & test plan F1 (human) disiapkan |
| 2026-07-14 | 5 bug fatal diperbaiki (`443d5f6`: abort/switch-sesi/debounce/setMyCommands) + command menu; **F1 human test 9/9 PASS** — Fase 1 tervalidasi end-to-end |
| 2026-07-14 | Dokumentasi dikoreksi: test plan f1→f0/f2→f1, status F2 di `docs/` dikembalikan ke "belum mulai" |
| 2026-07-14 | **Fase 2 selesai** (`9cdbf2f`): StateManager topic-aware (TDD 16/16 PASS), MessageQueue per-topic, handlers/events routing per message_thread_id, /newtopic + directory browser, /status per-topic, filter direktori session picker, topic deletion handling. **Human test 8/8 PASS** — Fase 2 tervalidasi end-to-end. |
| 2026-07-14 | **Fase 3 selesai** (`6edc7c9`): voice transcription (TranscriptionClient + OpenAI Whisper API + `:voice` handler), `/history` pagination (`paginateMessages`, `formatHistoryPage`, `buildHistoryKeyboard` + inline keyboard `◀ Older/Newer ▶`). **TDD 21/21 PASS.** |
| 2026-07-14 | **Fase 4 selesai**: README rewrite, .env.example lengkap, HealthMonitor crash detection + auto-restart, validateFeatureFlags(), config validation hardening, deploy `/opt/opencode-telegram` + systemd, uji stabilitas (crash→recovery ~15s, systemd restart clean). **TDD 27/27 PASS.** 1 bug ditemukan & diperbaiki saat uji stabilitas (`server.ts` stop() hang pada proses yang di-kill eksternal). |
| 2026-07-14 | **Fase 5 selesai** (branch `feat/ccbot-parity-f5-f7`): F5.1 permission approval sampai di forum topic (`e247c87`), F5.3 status live in-place + typing indicator (`0339488`), F5.2 interactive agent question buttons via poll GET /question (`751e081`). **TDD F5 20/20 PASS.** |
| 2026-07-14 | **Fase 6 selesai**: F6.1 Markdown rendering via `telegramify-markdown` + MarkdownV2 (`3de3348`). **TDD 7/7 PASS.** |
| 2026-07-14 | **Fase 7 selesai**: F7.1 kirim foto ke agent (`8cc460d`), F7.3 navigable directory browser (`cfbd5b2`), F7.2 relay gambar dari agent (`c08aa51`). **TDD 15/15 PASS.** |
| 2026-07-14 | **Fase 8 (bugfix) selesai**: `/providers` no longer 400s on long provider lists (`4b698a5`). TDD PASS. |
| 2026-07-14 | `feat/ccbot-parity-f5-f7` di-merge ke `main` (`1e5faae`). Build + deploy ke `/opt`, service di-restart 12:15. Semua fase F0–F8 selesai (kode). **Human test F3 & F5–F7 menunggu.** |
| 2026-07-14 | **Bugfix F9**: `/newtopic` directory browser selalu "(no subfolders)" — `/file` API butuh `directory` + `path` (`a6979d3`). |
| 2026-07-14 | **F7.3 enhancement**: "New folder" button di directory browser (`0049287`). |
| 2026-07-14 | **F10**: `/subagent on|off` toggle — default OFF, cegah subagent stuck via `tools: { task: false }` di `prompt_async` (`aef07c4`). |
| 2026-07-14 | **F11**: `/status` kini menampilkan permission overrides + timestamps created/updated (`e9d5ba5`). |
| 2026-07-14 | **F12**: `/move <dir> [--changes]`, `/compact`, `/delete <id>`, session state di `/status`, fix escaping `\-` `\_` (`5346cb4`). |
| 2026-07-14 | **F13**: Migrasi massal `parse_mode: 'HTML'` — semua 69 Markdown diganti HTML, escapeMarkdown→escapeHtml (`d681713`). `\` sebelum `_` dan `-` hilang selamanya. Strategi ccbot: HTML mode + hanya escape `&`, `<`, `>`. |
