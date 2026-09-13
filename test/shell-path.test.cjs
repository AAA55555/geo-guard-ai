'use strict'

const { test, describe, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  installPathEntry,
  uninstallPathEntry,
  uninstallPathEntriesEverywhere,
  pathEntryPresent,
  pathRcPathForShell,
  readPathBlock,
  pathBody,
  installBashLoginPathEntry,
  bashLoginFile,
  shellsToInstall,
} = require('../dist/shell-path')
const { PATH_BEGIN_MARKER, PATH_END_MARKER } = require('../dist/config')

const SHELLS = ['zsh', 'bash', 'fish', 'powershell']

describe('installPathEntry через GEO_GUARD_RC', () => {
  let tmp
  let rcFile
  let shimsDir
  let prevRc
  let prevShimDir

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-path-'))
    rcFile = path.join(tmp, '.zshrc')
    shimsDir = path.join(tmp, 'bin')
    prevRc = process.env.GEO_GUARD_RC
    prevShimDir = process.env.GEO_GUARD_SHIM_DIR
    process.env.GEO_GUARD_RC = rcFile
    process.env.GEO_GUARD_SHIM_DIR = shimsDir
  })

  after(() => {
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    if (prevShimDir === undefined) delete process.env.GEO_GUARD_SHIM_DIR
    else process.env.GEO_GUARD_SHIM_DIR = prevShimDir
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  beforeEach(() => {
    fs.rmSync(rcFile, { force: true })
  })

  test('пишет блок, PATH-строка идемпотентна в самом шелле', () => {
    const res = installPathEntry('zsh')

    assert.equal(res.changed, true)
    assert.equal(res.file, rcFile)
    const content = fs.readFileSync(rcFile, 'utf8')
    assert.ok(content.includes(PATH_BEGIN_MARKER))
    assert.ok(content.includes(PATH_END_MARKER))
    assert.match(content, /case ":\$PATH:" in/)
    assert.ok(content.includes(`*":${shimsDir}:"*) ;;`))
    assert.match(content, /export PATH/)
  })

  test('повторный install ничего не переписывает', () => {
    installPathEntry('zsh')
    const before = fs.readFileSync(rcFile, 'utf8')

    const res = installPathEntry('zsh')

    assert.equal(res.changed, false)
    assert.equal(res.alreadyPresent, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), before)
    assert.equal(pathEntryPresent('zsh'), true)
  })

  test('чужие строки целы, uninstall снимает только наш блок', () => {
    fs.writeFileSync(rcFile, 'export IMPORTANT=1\n')
    installPathEntry('zsh')

    const un = uninstallPathEntry(rcFile)

    assert.equal(un.changed, true)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.match(after, /export IMPORTANT=1/)
    assert.doesNotMatch(after, /geo-guard-ai path begin/)
    assert.equal(pathEntryPresent('zsh'), false)
  })

  test('чужое содержимое между нашими маркерами не трогается', () => {
    const foreign = `${PATH_BEGIN_MARKER}\nexport SECRET=1\n${PATH_END_MARKER}\n`
    fs.writeFileSync(rcFile, foreign)

    const res = installPathEntry('zsh')
    assert.equal(res.preserved, 'foreign')
    assert.equal(fs.readFileSync(rcFile, 'utf8'), foreign)

    const un = uninstallPathEntry(rcFile)
    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), foreign)
  })

  test('BEGIN без END не съедает файл', () => {
    const broken = `${PATH_BEGIN_MARKER}\nexport PATH="x:$PATH"\nexport WORK=1\n`
    fs.writeFileSync(rcFile, broken)

    const res = installPathEntry('zsh')
    assert.equal(res.preserved, 'foreign')

    const un = uninstallPathEntry(rcFile)
    assert.equal(un.changed, false)
    assert.equal(un.modified, true)
    assert.equal(fs.readFileSync(rcFile, 'utf8'), broken)
  })

  test('сменился каталог shim — наш блок обновляется, а не дублируется', () => {
    installPathEntry('zsh')
    const moved = path.join(tmp, 'bin2')

    const res = installPathEntry('zsh', { dir: moved })

    assert.equal(res.changed, true)
    const after = fs.readFileSync(rcFile, 'utf8')
    assert.equal(after.split(PATH_BEGIN_MARKER).length - 1, 1)
    assert.ok(after.includes(moved))
  })

  test('все четыре шелла пишут блок своего вида', () => {
    for (const shell of SHELLS) {
      fs.rmSync(rcFile, { force: true })
      installPathEntry(shell)
      const content = fs.readFileSync(rcFile, 'utf8')
      const block = readPathBlock(content)
      assert.equal(block.kind, 'pristine', shell)
      assert.equal(block.dir, shimsDir, shell)
      assert.equal(block.body, pathBody(shell, shimsDir), shell)
    }
  })

  test('fish и powershell выглядят так, как их читает их шелл', () => {
    assert.match(pathBody('fish', '/x/bin'), /^fish_add_path -p "\/x\/bin"$/)
    assert.match(pathBody('powershell', "/x/o'bin"), /\$geoGuardBin = '\/x\/o''bin'/)
    assert.match(pathBody('powershell', '/x/bin'), /\[IO\.Path\]::PathSeparator/)
  })

  test('GEO_GUARD_RC перекрывает выбор файла для любого шелла', () => {
    for (const shell of SHELLS) {
      assert.equal(pathRcPathForShell(shell), rcFile, shell)
    }
  })

  test('при заданном GEO_GUARD_RC login-файл bash не трогается вовсе', () => {
    assert.equal(installBashLoginPathEntry(), null)
  })
})

describe('PATH-блоки во временном HOME', () => {
  let tmpHome
  let prevHome
  let prevRc
  let prevShimDir

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-home-'))
    prevHome = process.env.HOME
    prevRc = process.env.GEO_GUARD_RC
    prevShimDir = process.env.GEO_GUARD_SHIM_DIR
    process.env.HOME = tmpHome
    delete process.env.GEO_GUARD_RC
    delete process.env.GEO_GUARD_SHIM_DIR
  })

  after(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    if (prevShimDir === undefined) delete process.env.GEO_GUARD_SHIM_DIR
    else process.env.GEO_GUARD_SHIM_DIR = prevShimDir
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  beforeEach(() => {
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) {
      fs.rmSync(path.join(tmpHome, name), { force: true })
    }
  })

  test('bash пишет в ~/.bashrc, zsh — в ~/.zshrc', { skip: process.platform === 'win32' }, () => {
    assert.equal(pathRcPathForShell('bash'), path.join(tmpHome, '.bashrc'))
    assert.equal(pathRcPathForShell('zsh'), path.join(tmpHome, '.zshrc'))

    installPathEntry('bash')
    assert.ok(fs.existsSync(path.join(tmpHome, '.bashrc')))
    assert.equal(fs.existsSync(path.join(tmpHome, '.zshrc')), false)
  })

  test('login-файл bash получает свою запись в PATH', { skip: process.platform === 'win32' }, () => {
    const res = installBashLoginPathEntry()

    assert.equal(res.changed, true)
    assert.equal(res.file, path.join(tmpHome, '.bash_profile'))
    const content = fs.readFileSync(res.file, 'utf8')
    // Именно строка PATH, а не подтягивание ~/.bashrc: неинтерактивный login-bash
    // до конца дистрибутивного ~/.bashrc не доходит.
    assert.match(content, /case ":\$PATH:" in/)
    assert.doesNotMatch(content, /\. ~\/\.bashrc/)
  })

  test('повторный вызов ничего не переписывает', { skip: process.platform === 'win32' }, () => {
    installBashLoginPathEntry()
    const before = fs.readFileSync(path.join(tmpHome, '.bash_profile'), 'utf8')

    const res = installBashLoginPathEntry()

    assert.equal(res.changed, false)
    assert.equal(res.alreadyPresent, true)
    assert.equal(fs.readFileSync(path.join(tmpHome, '.bash_profile'), 'utf8'), before)
  })

  test('к чужому login-файлу дописываем блок, ничего не теряя', { skip: process.platform === 'win32' }, () => {
    const profile = path.join(tmpHome, '.bash_profile')
    fs.writeFileSync(profile, 'export WORK=1\n')

    installBashLoginPathEntry()

    const content = fs.readFileSync(profile, 'utf8')
    assert.match(content, /export WORK=1/)
    assert.match(content, /geo-guard-ai path begin/)

    // и снимается тоже чисто
    const un = uninstallPathEntry(profile)
    assert.equal(un.changed, true)
    const after = fs.readFileSync(profile, 'utf8')
    assert.match(after, /export WORK=1/)
    assert.doesNotMatch(after, /geo-guard-ai/)
  })

  test('uninstallPathEntriesEverywhere проходит по всем rc', { skip: process.platform === 'win32' }, () => {
    installPathEntry('zsh')
    installPathEntry('bash')
    installBashLoginPathEntry()

    const results = uninstallPathEntriesEverywhere()

    assert.ok(results.filter(r => r.changed).length >= 3)
    assert.equal(pathEntryPresent('zsh'), false)
    assert.equal(pathEntryPresent('bash'), false)
  })
})

describe('выбор login-файла для bash', { skip: process.platform === 'win32' }, () => {
  // Регрессия: раньше ~/.bash_profile создавался вслепую. На Linux рядом обычно
  // лежит ~/.profile — созданный .bash_profile молча заслоняет его, и всё, что
  // туда положил дистрибутив (PATH, локаль, snap), перестаёт работать.
  let tmpHome
  let prevHome
  let prevRc
  let prevShimDir

  const LOGIN_FILES = ['.bash_profile', '.bash_login', '.profile']

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-guard-login-'))
    prevHome = process.env.HOME
    prevRc = process.env.GEO_GUARD_RC
    prevShimDir = process.env.GEO_GUARD_SHIM_DIR
    process.env.HOME = tmpHome
    delete process.env.GEO_GUARD_RC
    delete process.env.GEO_GUARD_SHIM_DIR
  })

  after(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevRc === undefined) delete process.env.GEO_GUARD_RC
    else process.env.GEO_GUARD_RC = prevRc
    if (prevShimDir === undefined) delete process.env.GEO_GUARD_SHIM_DIR
    else process.env.GEO_GUARD_SHIM_DIR = prevShimDir
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  beforeEach(() => {
    for (const name of [...LOGIN_FILES, '.bashrc', '.zshrc']) {
      fs.rmSync(path.join(tmpHome, name), { force: true })
    }
  })

  const home = name => path.join(tmpHome, name)

  test('нет ни одного login-файла → создаётся .bash_profile', () => {
    assert.equal(bashLoginFile(), home('.bash_profile'))

    const res = installBashLoginPathEntry()

    assert.equal(res.changed, true)
    assert.equal(res.file, home('.bash_profile'))
    assert.match(fs.readFileSync(home('.bash_profile'), 'utf8'), /geo-guard-ai path begin/)
  })

  test('.bash_profile существует → блок идёт в него', () => {
    fs.writeFileSync(home('.bash_profile'), 'export A=1\n')
    fs.writeFileSync(home('.profile'), 'export DISTRO=1\n')

    assert.equal(bashLoginFile(), home('.bash_profile'))
    const res = installBashLoginPathEntry()

    assert.equal(res.file, home('.bash_profile'))
    assert.match(fs.readFileSync(home('.bash_profile'), 'utf8'), /export A=1/)
    // .profile не наш файл в этом случае — он не должен измениться вовсе.
    assert.equal(fs.readFileSync(home('.profile'), 'utf8'), 'export DISTRO=1\n')
  })

  test('есть только ~/.profile → пишем в него, .bash_profile НЕ создаётся', () => {
    const original = 'export PATH="$HOME/.local/bin:$PATH"\n'
    fs.writeFileSync(home('.profile'), original)

    assert.equal(bashLoginFile(), home('.profile'))
    const res = installBashLoginPathEntry()

    assert.equal(res.changed, true)
    assert.equal(res.file, home('.profile'))
    assert.equal(
      fs.existsSync(home('.bash_profile')),
      false,
      'создав .bash_profile, мы заслонили бы ~/.profile',
    )
    const content = fs.readFileSync(home('.profile'), 'utf8')
    assert.ok(content.startsWith(original), 'чужое содержимое должно остаться на месте')
    assert.match(content, /geo-guard-ai path begin/)
  })

  test('.bash_login выигрывает у .profile, как и у самого bash', () => {
    fs.writeFileSync(home('.bash_login'), 'export B=1\n')
    fs.writeFileSync(home('.profile'), 'export DISTRO=1\n')

    assert.equal(bashLoginFile(), home('.bash_login'))
    assert.equal(installBashLoginPathEntry().file, home('.bash_login'))
    assert.equal(fs.readFileSync(home('.profile'), 'utf8'), 'export DISTRO=1\n')
  })

  // Раскладка Debian/Ubuntu: ~/.profile сам подтягивает ~/.bashrc. Это НЕ повод
  // не писать туда запись в PATH: дистрибутивный ~/.bashrc на второй строке
  // делает return для неинтерактивного шелла, так что `bash -lc claude` до
  // нашего блока в нём не доходит. Найдено прогоном в контейнере Debian.
  test('login-файл сорсит .bashrc → запись всё равно нужна, она туда и идёт', () => {
    const original = 'export DISTRO=1\n. ~/.bashrc\n'
    fs.writeFileSync(home('.profile'), original)

    const res = installBashLoginPathEntry()

    assert.equal(res.changed, true)
    assert.equal(res.file, home('.profile'))
    const content = fs.readFileSync(home('.profile'), 'utf8')
    assert.ok(content.startsWith(original), 'чужое содержимое остаётся нетронутым')
    assert.match(content, /geo-guard-ai path begin/)
  })

  test('uninstall снимает блок из того файла, куда он был записан', () => {
    fs.writeFileSync(home('.profile'), 'export DISTRO=1\n')
    installPathEntry('bash')
    const written = installBashLoginPathEntry().file
    assert.equal(written, home('.profile'))

    const results = uninstallPathEntriesEverywhere()

    assert.ok(
      results.some(r => r.file === home('.profile') && r.changed),
      '~/.profile должен входить в набор файлов для полной очистки',
    )
    const after = fs.readFileSync(home('.profile'), 'utf8')
    assert.match(after, /export DISTRO=1/)
    assert.doesNotMatch(after, /geo-guard-ai/)
    assert.equal(pathEntryPresent('bash'), false)
  })

  test('GEO_GUARD_RC → никакой login-файл не трогается', () => {
    const rc = path.join(tmpHome, 'isolated-rc')
    process.env.GEO_GUARD_RC = rc
    try {
      assert.equal(installBashLoginPathEntry(), null)
      for (const name of LOGIN_FILES) {
        assert.equal(fs.existsSync(home(name)), false, name)
      }
    } finally {
      delete process.env.GEO_GUARD_RC
    }
  })
})

describe('shellsToInstall', () => {
  test('конкретный шелл — только он', () => {
    assert.deepEqual(shellsToInstall('fish'), ['fish'])
  })

  test("'all' включает текущий шелл и не выдумывает лишних", () => {
    const shells = shellsToInstall('all')
    assert.ok(shells.length >= 1)
    for (const shell of shells) {
      assert.ok(SHELLS.includes(shell), shell)
    }
    assert.equal(new Set(shells).size, shells.length)
  })
})
