// File: test/fj/worktree-contract.mjs
// Bug J — verify dirBrowser worktreeRoot constraint and parentDir clamping.
// Tests the module-level worktreeRoot variable + parentDir behaviour.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

let mod
try { mod = await import('../../dist/bot/dirBrowser.js') } catch { /* not built */ }
const IMPL = !!(mod && typeof mod.parentDir === 'function' && typeof mod.setWorktreeRoot === 'function')

describe('Bug J NOT YET IMPLEMENTED — worktreeRoot constraint', { skip: IMPL }, () => {
  test('src/bot/dirBrowser.ts missing setWorktreeRoot/getWorktreeRoot', () => {
    assert.fail(
      'Export setWorktreeRoot(root) and getWorktreeRoot() from dirBrowser.ts. ' +
      'parentDir must clamp to worktreeRoot instead of /.'
    )
  })
})

describe('Bug J worktreeRoot contract', { skip: !IMPL }, () => {
  before(() => {
    mod.setWorktreeRoot(mod.getWorktreeRoot())
  })

  test('setWorktreeRoot / getWorktreeRoot round-trip', () => {
    mod.setWorktreeRoot('/home/fadh/workspace')
    assert.equal(mod.getWorktreeRoot(), '/home/fadh/workspace')
    // trailing slash stripped
    mod.setWorktreeRoot('/home/fadh/workspace/')
    assert.equal(mod.getWorktreeRoot(), '/home/fadh/workspace')
  })

  test('parentDir clamps to worktreeRoot (not /)', () => {
    mod.setWorktreeRoot('/home/fadh/workspace')
    assert.equal(mod.parentDir('/home/fadh/workspace/project/src'), '/home/fadh/workspace/project')
    assert.equal(mod.parentDir('/home/fadh/workspace/project'), '/home/fadh/workspace')
    // root itself — clamp
    assert.equal(mod.parentDir('/home/fadh/workspace'), '/home/fadh/workspace')
    // go up past root — clamp
    assert.equal(mod.parentDir('/home/fadh/workspace/'), '/home/fadh/workspace')
  })

  test('parentDir does not navigate above worktreeRoot', () => {
    mod.setWorktreeRoot('/home/fadh/workspace')
    // any path outside the worktree — clamps to root
    assert.equal(mod.parentDir('/home/fadh'), '/home/fadh/workspace')
    assert.equal(mod.parentDir('/home/fadh/workspace'), '/home/fadh/workspace')
  })

  test('parentDir with nested path inside worktree climbs normally', () => {
    mod.setWorktreeRoot('/home/fadh/workspace')
    assert.equal(mod.parentDir('/home/fadh/workspace/a/b/c'), '/home/fadh/workspace/a/b')
    assert.equal(mod.parentDir('/home/fadh/workspace/a/b'), '/home/fadh/workspace/a')
    assert.equal(mod.parentDir('/home/fadh/workspace/a'), '/home/fadh/workspace')
  })

  test('parentDir default worktreeRoot=/ behaves like old clamp to /', () => {
    mod.setWorktreeRoot('/')
    assert.equal(mod.parentDir('/a/b/c'), '/a/b')
    assert.equal(mod.parentDir('/a/b'), '/a')
    assert.equal(mod.parentDir('/a'), '/')
    assert.equal(mod.parentDir('/'), '/')
  })

  test('worktreeRoot strips trailing slash', () => {
    mod.setWorktreeRoot('/var/log/')
    assert.equal(mod.getWorktreeRoot(), '/var/log')
  })
})
