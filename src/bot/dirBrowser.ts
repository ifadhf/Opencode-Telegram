// Navigable directory browser for /newtopic. callback_data is limited to 64
// bytes, so buttons carry indices (dnav:<i>) / verbs (dup, dpick, dpg:<n>,
// dcancel) — never full paths. The current path + listing live in server-side
// browse state keyed by chat+thread.

import { escapeHtml } from '../utils/formatter.js'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export const DIRS_PER_PAGE = 6

export interface DirBrowserView {
  text: string
  inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>
}

// Module-level worktree root — set at startup from the -d flag.
// Restricts directory browser navigation to within this tree.
let worktreeRoot = '/'
export function setWorktreeRoot(root: string): void {
  worktreeRoot = root.replace(/\/+$/, '') || '/'
}
export function getWorktreeRoot(): string {
  return worktreeRoot
}

// Parent of an absolute path, clamped at worktreeRoot.
export function parentDir(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  if (trimmed === worktreeRoot || trimmed.length <= worktreeRoot.length) return worktreeRoot
  const idx = trimmed.lastIndexOf('/')
  const parent = idx <= 0 ? '/' : trimmed.slice(0, idx)
  if (parent.length < worktreeRoot.length || !parent.startsWith(worktreeRoot)) return worktreeRoot
  return parent
}

export function buildDirBrowser(currentPath: string, subdirs: DirEntry[], page: number): DirBrowserView {
  const totalPages = Math.max(1, Math.ceil(subdirs.length / DIRS_PER_PAGE))
  const p = Math.min(Math.max(0, page), totalPages - 1)
  const start = p * DIRS_PER_PAGE
  const pageDirs = subdirs.slice(start, start + DIRS_PER_PAGE)

  const rows: Array<Array<{ text: string; callback_data: string }>> = []
  pageDirs.forEach((d, i) => {
    rows.push([{ text: `📁 ${d.name}`, callback_data: `dnav:${start + i}` }])
  })

  if (totalPages > 1) {
    rows.push([
      { text: '◀', callback_data: `dpg:${p === 0 ? totalPages - 1 : p - 1}` },
      { text: `${p + 1}/${totalPages}`, callback_data: 'dnoop' },
      { text: '▶', callback_data: `dpg:${p === totalPages - 1 ? 0 : p + 1}` },
    ])
  }

  rows.push([
    { text: '⬆️ ..', callback_data: 'dup' },
    { text: '📁 New folder', callback_data: 'dnewfolder' },
  ])
  rows.push([
    { text: '✅ Select this folder', callback_data: 'dpick' },
    { text: '❌ Cancel', callback_data: 'dcancel' },
  ])

  let text = `📂 <b>Select working directory</b>\n<code>${escapeHtml(currentPath)}</code>`
  if (subdirs.length === 0) text += '\n\n<i>(no subfolders — Select this folder or go up)</i>'

  return { text, inlineKeyboard: rows }
}

// List the immediate subdirectories of a path (dirs only, hidden excluded,
// alphabetised). Loosely typed on the client so it stays unit-testable.
export async function listSubdirs(
  client: { listFiles: (p: string) => Promise<Array<{ name: string; path: string; absolute: string; type: string }>> },
  path: string
): Promise<DirEntry[]> {
  const entries = await client.listFiles(path)
  return entries
    .filter(e => e.type === 'directory' && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: e.absolute || e.path, isDir: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// --- server-side browse state (single process) ---

export interface BrowseState {
  path: string
  subdirs: DirEntry[]
  page: number
  pendingFolderCreate?: boolean
}

const browseStates = new Map<string, BrowseState>()
const browseKey = (chatId: number, threadId: number) => `${chatId}:${threadId}`

export function setBrowseState(chatId: number, threadId: number, s: BrowseState): void {
  browseStates.set(browseKey(chatId, threadId), s)
}
export function getBrowseState(chatId: number, threadId: number): BrowseState | undefined {
  return browseStates.get(browseKey(chatId, threadId))
}
export function clearBrowseState(chatId: number, threadId: number): void {
  browseStates.delete(browseKey(chatId, threadId))
}

export function getPendingFolderCreate(chatId: number, threadId: number): string | undefined {
  const s = browseStates.get(browseKey(chatId, threadId))
  return s?.pendingFolderCreate ? s.path : undefined
}

export function setPendingFolderCreate(chatId: number, threadId: number): void {
  const s = browseStates.get(browseKey(chatId, threadId))
  if (s) s.pendingFolderCreate = true
}

export function clearPendingFolderCreate(chatId: number, threadId: number): void {
  const s = browseStates.get(browseKey(chatId, threadId))
  if (s) s.pendingFolderCreate = false
}
