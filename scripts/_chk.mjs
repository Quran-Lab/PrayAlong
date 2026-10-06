import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const c of ['yusuf', 'ahmad', 'maryam', 'aisha']) for (const pose of ['jalsah', 'tashahhud', 'salam-left']) {
  const p = await b.newPage({ viewport: { width: 520, height: 520 } })
  await p.goto(`http://localhost:5173/?lab&pose=${pose}&az=0.7&character=./avatars/${c}.glb`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(4500)
  await p.screenshot({ path: `shots/all-${c}-${pose}.png` }); await p.close()
}
await b.close()
