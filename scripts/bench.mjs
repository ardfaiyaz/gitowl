// Times core operations on a generated large repository under work/. Usage: node scripts/bench.mjs [commits] [files]
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { startServer, defaultExecutable } from './server.mjs'

const commits = Number(process.argv[2] || 5000)
const files = Number(process.argv[3] || 2000)
const workspace = resolve('work')
mkdirSync(workspace, { recursive: true })
const fixture = mkdtempSync(join(workspace, 'bench-'))
const repo = join(fixture, 'large')
mkdirSync(repo)
const git = (args, input) => execFileSync('git', ['-C', repo, ...args], { input, encoding: 'utf8', maxBuffer: 1 << 30, windowsHide: true })

// fast-import builds the history in one process instead of thousands of commits.
let stream = ''
for (let i = 1; i <= commits; i++) {
  stream += `commit refs/heads/main\ncommitter Bench <bench@example.invalid> ${1700000000 + i} +0000\ndata <<END\nCommit ${i}\nEND\n`
  if (i === 1) for (let f = 0; f < files; f++) stream += `M 100644 inline src/file${f}.txt\ndata <<END\nfile ${f}\nEND\n`
  stream += `M 100644 inline src/file${i % files}.txt\ndata <<END\nfile ${i % files} revision ${i}\nEND\n`
}
git(['init', '-q', '-b', 'main'])
let start = performance.now()
git(['fast-import', '--quiet'], stream)
git(['reset', '-q', '--hard', 'main'])
console.log(`Generated ${commits} commits, ${files} files in ${Math.round(performance.now() - start)} ms`)
writeFileSync(join(repo, 'src', 'file1.txt'), Array.from({ length: 20000 }, (_, i) => `changed line ${i}`).join('\n'))

const server = await startServer(process.argv[4] || defaultExecutable, repo, { LOCALAPPDATA: fixture, XDG_CONFIG_HOME: fixture })
const results = []
try {
  const boot = await (await server.request({ op: 'bootstrap' })).json()
  const time = async (label, data) => {
    start = performance.now()
    const response = await server.request({ repo: boot.repo, ...data })
    if (!response.ok) throw new Error(`${label}: ${(await response.json()).error}`)
    results.push({ operation: label, ms: Math.round(performance.now() - start) })
  }
  await time('status (open workspace)', { op: 'status' })
  await time('history page 1', { op: 'history', page: 0 })
  await time('history page 100', { op: 'history', page: 100 })
  await time('history message search', { op: 'history', query: 'Commit 4999' })
  await time('file history (follow)', { op: 'history', file: 'src/file7.txt' })
  await time('diff 20k-line file', { op: 'diff', file: 'src/file1.txt', mode: 'working' })
  await time('branches', { op: 'branches' })
  console.table(results)
  // Performance target: a typical repository opens within 3 seconds.
  const open = results[0].ms
  console.log(open < 3000 ? `PASS: status ${open} ms < 3000 ms target` : `SLOW: status ${open} ms exceeds 3000 ms target`)
} finally {
  await server.stop()
  if (!resolve(fixture).startsWith(workspace + sep)) throw new Error('Invalid cleanup path')
  rmSync(fixture, { recursive: true, force: true })
}
