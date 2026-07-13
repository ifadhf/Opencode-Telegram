# Test F2 — Forum topics / multi-sesi

Dua test suite untuk Fase 2. Dijalankan langsung oleh AI agent (otomatis, tanpa interaksi Telegram/manusia).

## Cara menjalankan

Dari root repo (`~/workspace/opencode-telegram-dev/Opencode-Telegram/`):

```bash
# Build dulu supaya dist/ sinkron (test import dari dist/)
npm run build

# Prasyarat API — butuh OpenCode server hidup di :4097
node --test test/f2/prereq-api.mjs

# Kontrak StateManager — tidak butuh server
node --test test/f2/state-contract.mjs

# Jalankan keduanya sekaligus
node --test test/f2/
```

Override URL/direktori lewat env bila perlu:

```bash
OPENCODE_URL=http://127.0.0.1:4097 \
OC_TEST_DIR=/home/fadh/workspace/opencode-telegram-dev/oc-test \
OTHER_DIR=/home/fadh/opencode \
node --test test/f2/prereq-api.mjs
```

## `prereq-api.mjs` — prasyarat API (status: ✅ LULUS saat ini)

Menguji endpoint OpenCode yang menjadi fondasi F2. **Tidak butuh kode F2 diimplementasi** — murni verifikasi bahwa OpenCode server mendukung apa yang F2 butuhkan. Prasyarat: server hidup (`systemctl --user start opencode-tele` atau `opencode serve --port 4097 --pure`).

Menguji:
- `GET /session` respons array
- `GET /session?directory=<dir>` — semua sesi yang dikembalikan punya `.directory` sesuai filter (isolasi)
- Dua direktori berbeda → himpunan session id disjoint (tidak bocor lintas direktori)
- `/session` tanpa filter = superset dari hasil filter
- `POST /session {directory}` — sesi baru terikat ke direktori yang diminta
- `GET /api/fs/list?path=<dir>` — mengembalikan `{location, data:[{path,type}]}`, termasuk file yg diharapkan

## `state-contract.mjs` — kontrak StateManager topic-binding (status: ❌ BELUM LULUS — TDD spec)

Spec yang harus dipenuhi implementasi F2 pada `src/state/manager.ts`. Saat ini **gagal dengan pesan jelas** ("F2 StateManager contract not implemented") karena metode topic-aware belum ada — ini sengaja (TDD: tulis test dulu, implementasi F2 dibuat supaya test lulus).

API yang diharapkan (ditambahkan ke `StateManager` saat F2):

```ts
setTopicSession(chatId, threadId, { sessionId, cwd, model?, mode? })
getTopicSession(chatId, threadId) -> binding | undefined
clearTopicSession(chatId, threadId)
getTopicBySession(sessionId) -> { chatId, threadId } | undefined   // routing notifikasi balik ke thread yg benar
getAllTopics(chatId) -> Array<{ threadId, sessionId, cwd, model, mode }>   // /status per-topic
```

Menguji (setelah F2 diimplementasi):
- round-trip bind + retrieve
- isolasi antar thread dalam chat sama
- isolasi antar chat dengan thread id sama
- reverse-lookup `getTopicBySession`
- `getAllTopics` per chat
- `clearTopicSession` hanya hapus 1 binding (tidak ganggu lain)
- persistensi save + reload
- backward-compat dengan API lama `setCurrentSession(chatId, sessionId)`

## Status expected

| Suite | Sebelum F2 | Setelah F2 |
|---|---|---|
| `prereq-api.mjs` | ✅ lulus (server hidup) | ✅ lulus |
| `state-contract.mjs` | ❌ gagal ("not implemented") | ✅ lulus |

Saat `state-contract.mjs` lulus, inti F2 (state layer) sudah benar. Lanjut ke routing per `message_thread_id` di `handlers.ts`.
