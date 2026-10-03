/*
 * main.js — bootstrap. Wires GameState + Puzzle + Renderer + Controls
 * together and owns level flow (enter, complete, next, reset).
 */
;(function () {
  'use strict'

  var LEVELS = ML.game.LEVELS
  var GameState = ML.game.GameState
  var Puzzle = ML.game.Puzzle
  var Renderer = ML.ui.Renderer
  var Controls = ML.ui.Controls

  var game = new GameState(LEVELS)
  var puzzle = new Puzzle(game.level)

  var renderer = new Renderer({ root: document })
  var controls = new Controls({
    puzzle: puzzle,
    renderer: renderer,
    gameState: game,
    room: document.getElementById('room'),
    stage: document.getElementById('stage'),
    isBlocked: function () {
      return document.body.classList.contains('menu-open') || document.body.classList.contains('demo-mode')
    },
    onReset: function () { doReset() },
    onNext: function () { doNext() },
    onPrevious: function () { doPrevious() }
  })

  /* ------------------------------------------------------------------ *
   * Puzzle -> UI
   * ------------------------------------------------------------------ */

  puzzle.on('measure', function (ev) {
    game.recordMeasurement(ev.probability)
    game.recordCollapse()
  })

  puzzle.on('select', function () {
    renderer.render(puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
  })

  puzzle.on('gate', function (ev) {
    game.recordGate()
    renderer.showGate(ev)
  })

  puzzle.on('survey', function (ev) {
    game.recordGate()
    renderer.showSurvey(ev)
    renderer.render(puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
  })

  puzzle.on('switch', function () {
    renderer.render(puzzle.getSnapshot())
  })

  puzzle.on('lock', function (info) {
    renderer.showLock(info)
    renderer.render(puzzle.getSnapshot())
  })

  puzzle.on('branch', function (info) {
    renderer.render(puzzle.getSnapshot())
  })

  puzzle.on('door', function (info) {
    renderer.doorOpened(info, puzzle.getSnapshot())
    renderer.render(puzzle.getSnapshot())
  })

  puzzle.on('blocked', function (info) {
    renderer.showBlocked(info)
  })

  puzzle.on('complete', function (info) {
    game.completeLevel()
    renderer.dom.btnNext.disabled = !game.hasNext()
    showComplete(info.level)
  })

  puzzle.on('reset', function () {
    renderer.hideOverlay()
    renderer.render(puzzle.getSnapshot())
  })

  game.on('level:enter', function () {
    renderer.hideOverlay()
    renderer.setDots(LEVELS, game.index, game.completed)
    puzzle.load(game.level)
    renderer.build(game.level, puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
    renderer.dom.btnNext.disabled = true
    renderer.dom.btnPrev.disabled = !game.hasPrevious()
  })

  game.on('level:restart', function () {
    puzzle.reset()
    renderer.build(game.level, puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
    renderer.dom.btnNext.disabled = true
  })

  /* ------------------------------------------------------------------ *
   * Readout rows act as measurement shortcuts
   * ------------------------------------------------------------------ */

  renderer.onMeasure = function (nodeId, basis) {
    puzzle.measure(nodeId, basis)
  }

  renderer.onNext = function () { doNext() }
  renderer.onReset = function () { doReset() }

  /* ------------------------------------------------------------------ *
   * Flow
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** { done, total } for the header stat strip. */
  function objectives () {
    var locks = puzzle.lockList()
    var done = locks.filter(function (l) { return l.satisfied }).length
    return { done: done, total: locks.length }
  }

  function measurementSnapshot (level) {
    var recent = puzzle.events.slice(-3).map(function (e) {
      return e.type === 'measure'
        ? e.nodeId + ' ' + e.basis + ' \u2192 ' + e.result
        : e.nodeId + ' \u00b7 ' + e.gateLabel
    })
    return recent
  }

  function showComplete (level) {
    var lines = []
    var stats = [
      { key: 'READOUTS', value: puzzle.events.filter(function (e) { return e.type === 'measure' }).length },
      { key: 'LOCKS RELEASED', value: puzzle.def.locks.length },
      { key: 'RESETS', value: game.stats.resets }
    ]

    if (level.finale || game.isLast()) {
      var isLastLab = game.isLast()
      lines.push('Every door in the lab answered the same rule.')
      lines.push('|0\u27e9 and |1\u27e9 answer Z with certainty. |+\u27e9 and |\u2212\u27e9 answer X with certainty.')
      lines.push('Read the same node in the other basis and certainty is gone \u2014 fifty fifty, every time.')
      lines.push('After a readout the state has collapsed: ask the same basis again and it answers the same.')
      if (!isLastLab) {
        lines.push('An annex is still open beyond the vault \u2014 it only asks for more of the same physics.')
      }
      lines.push('')
      lines.push('Measurement isn\u2019t just looking. How you measure matters.')
      stats = [
        { key: 'LABS CLEARED', value: game.completedCount() + '/' + LEVELS.length },
        { key: 'TOTAL READOUTS', value: game.stats.measurements },
        { key: 'RANDOM OUTCOMES', value: game.stats.probabilistic }
      ]
      renderer.showLevelComplete({
        kicker: 'MEASUREMENT LOCK \u00b7 ' + (isLastLab ? 'COMPLETE' : 'VAULT OPEN'),
        title: 'VAULT OPEN',
        lines: lines,
        stats: stats,
        nextLabel: isLastLab ? 'RUN THE LABS AGAIN' : 'CONTINUE TO THE ANNEX \u2192',
        quoteIndex: lines.length - 1
      })
      var btn = document.getElementById('ov-next')
      if (btn && isLastLab) {
        btn.addEventListener('click', function () {
          game.resetProgress()
          game.goTo(0, 'restart-run')
        }, { once: true })
      }
      return
    }

    var trace = measurementSnapshot(level)
    lines.push('Readouts this lab: ' + (trace.length ? trace.join('   \u00b7   ') : 'none'))
    lines.push('')
    lines.push(LEVELS[game.index + 1].name + ' awaits.')

    renderer.showLevelComplete({
      kicker: 'LOCK RELEASED',
      title: level.name,
      lines: lines,
      stats: stats,
      nextLabel: 'NEXT LEVEL \u2192'
    })
  }

  function doNext () {
    if (game.hasNext()) {
      game.next()
    } else {
      game.resetProgress()
      game.goTo(0, 'restart-run')
    }
  }

  function doPrevious () {
    if (game.hasPrevious()) game.previous()
  }

  function doReset () {
    game.restartLevel()
  }

  /* ------------------------------------------------------------------ *
   * Measurement result feedback
   * ------------------------------------------------------------------ */

  var origMeasure = puzzle.measure.bind(puzzle)
  puzzle.measure = function (nodeId, basis) {
    var info = origMeasure(nodeId, basis)
    if (info) renderer.showMeasurement(info)
    renderer.render(puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
    return info
  }

  var origDevice = puzzle.applyDevice.bind(puzzle)
  puzzle.applyDevice = function (deviceId) {
    var res = origDevice(deviceId)
    renderer.render(puzzle.getSnapshot())
    renderer.setStats(game.stats, objectives())
    return res
  }

  /* ------------------------------------------------------------------ *
   * Go
   * ------------------------------------------------------------------ */

  renderer.setDots(LEVELS, game.index, game.completed)
  renderer.build(game.level, puzzle.getSnapshot())
  renderer.setStats(game.stats, objectives())
  renderer.dom.btnPrev.disabled = !game.hasPrevious()
  window.addEventListener('resize', function () { renderer.resize() })

  // pick up where the player left off, then honour #lab=N in the URL
  var jump = /lab=(\d+)/.exec(window.location.hash || '')
  if (jump) {
    var want = parseInt(jump[1], 10) - 1
    if (want >= 0 && want < LEVELS.length) game.goTo(want, 'hash')
  } else if (game.load()) {
    game.emit('level:enter', { index: game.index, level: game.level, reason: 'restore', changed: false })
  }

  // remember progress as it happens
  game.on('level:complete', function () { game.save() })
  game.on('level:enter', function () { game.save() })
  game.on('progress:reset', function () { game.clearSaved() })

  /* ------------------------------------------------------------------ *
   * Main menu and Demo Mode
   *
   * Everything here is optional: a page that embeds the game without the
   * menu markup still boots normally.
   * ------------------------------------------------------------------ */

  var titleScreen = document.getElementById('title-screen')
  var btnTitlePlay = document.getElementById('title-play')
  var btnTitleDemo = document.getElementById('title-demo')
  var btnDemo = document.getElementById('btn-demo')
  var demo = null

  // These live at function scope on purpose: block-scoped declarations would
  // be invisible to the #demo autostart and the Escape handler below.
  function openMenu () {
    if (!titleScreen) return
    titleScreen.classList.add('is-live')
    document.body.classList.add('menu-open')
  }

  function closeMenu () {
    if (!titleScreen) return
    titleScreen.classList.remove('is-live')
    document.body.classList.remove('menu-open')
  }

  function startDemo () {
    if (!demo) return
    closeMenu()
    demo.start()
  }

  if (ML.ui.Demo && titleScreen && btnTitlePlay && btnTitleDemo) {
    demo = new ML.ui.Demo({
      game: game,
      puzzle: puzzle,
      renderer: renderer,
      controls: controls,
      onExit: function () {
        renderer.render(puzzle.getSnapshot())
        renderer.setStats(game.stats, objectives())
      }
    })

    btnTitlePlay.addEventListener('click', closeMenu)
    btnTitleDemo.addEventListener('click', startDemo)
    if (btnDemo) btnDemo.addEventListener('click', startDemo)

    // clicking anywhere in the room means "I want to play", so get out of the way
    document.getElementById('main').addEventListener('click', function () {
      if (titleScreen.classList.contains('is-live')) closeMenu()
    })

    openMenu()

    // #demo starts Demo Mode straight away, which is handy for recording
    if (/demo/.test(window.location.hash || '')) startDemo()
  }

  window.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return
    if (demo && demo.running) { demo.stop(); return }
    if (titleScreen && titleScreen.classList.contains('is-live')) {
      titleScreen.classList.remove('is-live')
      document.body.classList.remove('menu-open')
    }
  })

  // #demo starts Demo Mode straight away, which is handy for recording
  if (/demo/.test(window.location.hash || '') && demo) {
    closeMenu()
    demo.start()
  }

  // expose for debugging / automated checks
  window.MEASUREMENT_LOCK = {
    game: game,
    puzzle: puzzle,
    renderer: renderer,
    controls: controls,
    demo: demo,
    levels: LEVELS,
    quantum: ML.quantum,
    ui: ML.ui,
    GameState: GameState
  }
})()
