// Windows regression check: WebView2 must start with a write-protected executable folder.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

assert.equal(process.platform, 'win32', 'This check requires Windows and the WebView2 Runtime')
const executable = resolve(process.argv[2] || 'target/debug/gitowl.exe')
const workspace = resolve('work')
mkdirSync(workspace, { recursive: true })
const fixture = mkdtempSync(join(workspace, 'desktop-'))
const binaryDir = join(fixture, 'installed')
const profile = join(fixture, 'profile')
const repo = join(fixture, 'project')
for (const dir of [binaryDir, profile, repo]) mkdirSync(dir)
const installed = join(binaryDir, 'gitowl.exe')
copyFileSync(executable, installed)
const identity = execFileSync('whoami', { encoding: 'utf8', windowsHide: true }).trim()
const command = (file, args) => execFileSync(file, args, { windowsHide: true, stdio: 'pipe' })
let child
let exit
let protectedDirectory = false
try {
  command('git', ['-C', repo, 'init', '-b', 'main'])
  // Deny creation of files/subdirectories here, while preserving read/execute permissions.
  command('icacls', [binaryDir, '/deny', `${identity}:(WD,AD)`])
  protectedDirectory = true
  const env = { ...process.env, LOCALAPPDATA: profile }
  // An inherited override could mask the regression this check is intended to detect.
  delete env.WEBVIEW2_USER_DATA_FOLDER
  child = spawn(installed, [], { cwd: repo, env, windowsHide: true })
  exit = new Promise(resolve => child.once('exit', resolve))
  await new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`Desktop did not become ready. ${output}\n${errors}`)), 30000)
    const fail = error => { clearTimeout(timer); reject(error) }
    child.on('error', fail)
    child.stderr.on('data', data => { errors += data.toString() })
    child.stdout.on('data', data => {
      output += data.toString()
      if (output.includes('gitowl desktop ready:repository')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('exit', code => fail(new Error(`Desktop exited (${code}). ${errors}`)))
  })
  assert.ok(existsSync(join(profile, 'gitowl', 'WebView2')), 'Browser data must use the user profile')
  assert.ok(!existsSync(installed + '.WebView2'), 'Browser data must not be written beside the executable')
} finally {
  if (child && child.exitCode === null && child.pid) {
    // taskkill can report failure when WebView2 children exit during tree traversal,
    // even though it successfully terminates our host. Verify the host actually exits.
    const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
    let timer
    try {
      await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Desktop did not stop: ${killed.error || killed.stderr}`)), 5000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  if (protectedDirectory) command('icacls', [binaryDir, '/remove:d', identity])
  assert.ok(resolve(fixture).startsWith(workspace + sep))
  // WebView2 browser processes can release their profile files shortly after the host exits.
  rmSync(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
console.log('PASS: native desktop renders a repository from a write-protected installation folder')
