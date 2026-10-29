// Starts a headless gitowl server and resolves its URL; shared by smoke and benchmark scripts.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export const defaultExecutable = resolve('target/debug/gitowl' + (process.platform === 'win32' ? '.exe' : ''))

export async function startServer(executable, cwd, env) {
  const child = spawn(executable, ['--no-browser'], { cwd, windowsHide: true, env: { ...process.env, ...env } })
  const url = await new Promise((accept, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 15000)
    child.stdout.on('data', data => {
      output += data.toString()
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/)
      if (match) { clearTimeout(timeout); accept(new URL(match[0])) }
    })
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timeout); reject(new Error('Server exited: ' + code)) })
  })
  const token = new URLSearchParams(url.hash.slice(1)).get('token')
  const request = (data, headers = {}) => fetch(url.origin + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gitowl-token': token, ...headers }, body: JSON.stringify(data) })
  const stop = async () => {
    const stopped = new Promise(r => child.once('exit', r))
    child.kill()
    await Promise.race([stopped, new Promise(r => setTimeout(r, 3000))])
  }
  return { child, origin: url.origin, request, stop }
}
