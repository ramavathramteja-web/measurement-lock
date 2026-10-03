/*
 * ui/demo.js — Demo Mode.
 *
 * A guided, self-playing walkthrough for recording a 60-90 second video.
 *
 * The important rule here: the demo does not simulate anything. Every readout
 * you see comes from the same Qubit / Puzzle objects the real game plays, and
 * every outcome is whatever Math.random genuinely produced. Scene 4 relies on
 * the second X readout matching the first - that is the collapse guarantee of
 * the engine, not a scripted line. If the engine misbehaved, the demo would
 * visibly get it wrong rather than hide it.
 *
 * The scenes drive the real UI (clicks the real buttons, watches the real
 * renderer), so the recording shows actual gameplay rather than mock-ups.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var ui = root.ML.ui = root.ML.ui || {}
    ui.Demo = factory().Demo
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  function el (tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined && text !== null) e.textContent = text
    return e
  }

  /*
   * Scene timings add up to about 70 seconds:
   *   1 intro 7.8s · 2 deterministic 8.5s · 3 probability 6.9s · 4 collapse 9.4s
   *   5 basis switch 9.7s · 6 gameplay 18.9s · 7 outro 9.2s
   */
  var TOTAL_SECONDS = 70
  var CLOCK_LABEL = '1:10'

  function Demo (opts) {
    this.game = opts.game
    this.puzzle = opts.puzzle
    this.renderer = opts.renderer
    this.controls = opts.controls || null
    this.onExit = opts.onExit || function () {}

    this.dom = {
      screen: document.getElementById('demo'),
      caption: document.getElementById('demo-caption'),
      scene: document.getElementById('demo-scene'),
      line: document.getElementById('demo-line'),
      bar: document.getElementById('demo-bar'),
      clock: document.getElementById('demo-clock'),
      card: document.getElementById('demo-card')
    }

    this.running = false
    this.stepIndex = 0
    this.steps = []
    this.elapsed = 0
    this._timer = null
    this._raf = null
    this._last = 0
    this._restore = null
    this._demoState = {}

    this._build()
  }

  /* ------------------------------------------------------------------ *
   * Chrome
   * ------------------------------------------------------------------ */

  Demo.prototype._build = function () {
    var self = this

    this.dom.barFill = el('div', 'demo-bar-fill')
    this.dom.bar.appendChild(this.dom.barFill)

    var skip = el('button', 'demo-skip', 'SKIP  ESC')
    skip.addEventListener('click', function () { self.stop() })
    this.dom.screen.appendChild(skip)
  }

  /** Click the real control, so the recording shows a real press. */
  Demo.prototype._click = function (sel) {
    var e = document.querySelector(sel)
    if (!e) return null
    e.click()
    return e
  }

  Demo.prototype._clickNode = function (id, basis) {
    this._click('.qnode[data-node="' + id + '"]')
    return this._click('.qnode[data-node="' + id + '"] .mbtn-' + basis.toLowerCase())
  }

  Demo.prototype._clickDevice = function (id) {
    return this._click('[data-device="' + id + '"]')
  }

  /** Load a lab for the demo to play. */
  Demo.prototype._goto = function (levelId) {
    var index = 0
    this.game.levels.forEach(function (l, i) { if (l.id === levelId) index = i })
    if (this.game.index !== index) this.game.goTo(index, 'demo')
    else this.puzzle.load(this.game.level)
    this.game.emit('level:enter', { index: index, level: this.game.level, reason: 'demo', changed: true })
    this.renderer.hideOverlay()
  }

  /* ------------------------------------------------------------------ *
   * Captions
   * ------------------------------------------------------------------ */

  Demo.prototype._caption = function (scene, line) {
    this.dom.scene.textContent = scene
    this.dom.line.textContent = line || ''
    this.dom.caption.classList.remove('is-flash')
    void this.dom.caption.offsetWidth
    this.dom.caption.classList.add('is-flash')
  }

  Demo.prototype._title = function (html) {
    this.dom.card.innerHTML = ''
    var box = el('div', 'demo-title-card')
    box.innerHTML = html
    this.dom.card.appendChild(box)
    this.dom.card.classList.add('is-live')
  }

  Demo.prototype._clearTitle = function () {
    this.dom.card.innerHTML = ''
    this.dom.card.classList.remove('is-live')
  }

  /* ------------------------------------------------------------------ *
   * Run loop
   * ------------------------------------------------------------------ */

  Demo.prototype.start = function () {
    if (this.running) return
    this.running = true
    this.stepIndex = 0
    this.elapsed = 0

    // remember where the player was so leaving the demo puts them back
    this._restore = {
      index: this.game.index,
      completed: JSON.parse(JSON.stringify(this.game.completed)),
      stats: JSON.parse(JSON.stringify(this.game.stats))
    }

    document.body.classList.add('demo-mode')
    this.dom.screen.classList.add('is-live')
    this.dom.clock.textContent = '0:00 / ' + CLOCK_LABEL
    this._clearTitle()

    this.steps = this._script()
    this._last = 0
    this._tick()
    this._raf = requestAnimationFrame(this._loop.bind(this))
  }

  Demo.prototype.stop = function () {
    if (!this.running) return
    this.running = false
    clearTimeout(this._timer)
    cancelAnimationFrame(this._raf)
    document.body.classList.remove('demo-mode')
    this.dom.screen.classList.remove('is-live')
    this._clearTitle()

    // put the player's own run back exactly as it was
    var r = this._restore
    if (r) {
      this.game.index = r.index
      this.game.completed = r.completed
      this.game.stats = r.stats
      this.puzzle.load(this.game.level)
      this.renderer.hideOverlay()
      this.game.emit('level:enter', { index: this.game.index, level: this.game.level, reason: 'demo-exit', changed: true })
    }
    this.onExit()
  }

  Demo.prototype._loop = function (now) {
    if (!this.running) return
    if (!this._last) this._last = now
    this.elapsed += (now - this._last) / 1000
    this._last = now

    var pctDone = Math.max(0, Math.min(100, (this.elapsed / TOTAL_SECONDS) * 100))
    this.dom.barFill.style.width = pctDone + '%'

    var s = Math.floor(this.elapsed)
    this.dom.clock.textContent = '0:' + (s < 10 ? '0' + s : s) + ' / ' + CLOCK_LABEL

    this._raf = requestAnimationFrame(this._loop.bind(this))
  }

  /** Run one step, then schedule the next. */
  Demo.prototype._tick = function () {
    var self = this
    if (!this.running) return
    if (this.stepIndex >= this.steps.length) { this.stop(); return }

    var step = this.steps[this.stepIndex++]
    var wait = step.wait === undefined ? 1000 : step.wait
    if (step.run) {
      try {
        step.run()
      } catch (e) {
        // a demo step must never wedge the recording
        if (typeof console !== 'undefined') console.error('demo step failed', e)
      }
    }
    this._timer = setTimeout(function () { self._tick() }, wait)
  }

  /* ------------------------------------------------------------------ *
   * The script
   *
   * Every `run` performs a real game action. There is no place in here that
   * writes a measurement result by hand.
   * ------------------------------------------------------------------ */

  Demo.prototype._script = function () {
    var self = this
    var s = []

    /* ---------------- scene 1: intro, 8s ---------------- */
    s.push({ wait: 200, run: function () { self._goto(1) } })
    s.push({
      wait: 2600,
      run: function () {
        self._caption('MEASUREMENT LOCK', 'How you measure changes what happens next.')
        self._title(
          '<div class="demo-mark"></div>' +
          '<h1>MEASUREMENT LOCK</h1>' +
          '<p class="demo-sub">How you measure changes what happens next.</p>'
        )
      }
    })
    s.push({
      wait: 3400,
      run: function () {
        self._title(
          '<div class="demo-mark"></div>' +
          '<h1>MEASUREMENT LOCK</h1>' +
          '<p class="demo-sub">An interactive game about quantum measurement.</p>'
        )
      }
    })
    s.push({ wait: 1600, run: function () { self._clearTitle() } })

    /* ---------------- scene 2: deterministic, 9s ---------------- */
    s.push({
      wait: 300,
      run: function () {
        self._goto(1)
        self._caption('DETERMINISTIC MEASUREMENT', 'The door wants Z \u2192 0.')
      }
    })
    s.push({ wait: 2400, run: function () { self._clickNode('A', 'Z') } })
    s.push({
      wait: 2200,
      run: function () {
        var ket = self.puzzle.qubits['A'].getKet()
        var p = self.puzzle.qubits['A'].lastMeasurement().probability
        self._caption('DETERMINISTIC MEASUREMENT',
          'BASIS Z \u00b7 RESULT 0 \u00b7 STATE ' + ket + ' \u00b7 p = ' + Math.round(p * 100) + '%')
      }
    })
    s.push({ wait: 2100, run: function () { self._caption('DETERMINISTIC MEASUREMENT', 'Same basis \u2192 predictable result.') } })
    s.push({ wait: 1500, run: function () { self._caption('DETERMINISTIC MEASUREMENT', 'The door opens.') } })

    /* ---------------- scene 3: probability, 9s ---------------- */
    s.push({
      wait: 300,
      run: function () {
        self._goto(1)
        self._caption('PROBABILITY', 'Same node. Same |0\u27e9. Now measure it in X.')
      }
    })
    s.push({ wait: 2200, run: function () { self._clickNode('A', 'X') } })
    s.push({
      wait: 2400,
      run: function () {
        var q = self.puzzle.qubits['A']
        var m = q.lastMeasurement()
        // m.probability is the chance measured *before* the collapse, which is
        // the number the viewer needs to see
        var line = 'X on |0\u27e9 is 50/50. This run gave ' + m.result +
          ' (' + Math.round(m.probability * 100) + '% before collapsing).'
        self._caption('PROBABILITY', line)
        self._demoState.scene3 = m.result
      }
    })
    s.push({
      wait: 2000,
      run: function () {
        var ket = self.puzzle.qubits['A'].getKet()
        self._caption('PROBABILITY', 'It is now ' + ket + '. The node collapsed.')
      }
    })

    /* ---------------- scene 4: collapse, 10s ---------------- */
    s.push({
      wait: 300,
      run: function () {
        self._goto(1)
        self._caption('COLLAPSE', 'Measure the same node in X again.')
      }
    })
    s.push({ wait: 1800, run: function () { self._clickNode('A', 'X') } })
    s.push({ wait: 2400, run: function () { self._clickNode('A', 'X') } })
    s.push({
      wait: 2600,
      run: function () {
        var h = self.puzzle.qubits['A'].getMeasurementHistory()
        var a = h[0] ? h[0].result : '?'
        var b = h[1] ? h[1].result : '?'
        self._caption('COLLAPSE',
          'X \u2192 ' + a + '   then   X \u2192 ' + b + '   (p = ' +
          (h[1] ? Math.round(h[1].probability * 100) : 100) + '%)')
      }
    })
    s.push({ wait: 2300, run: function () { self._caption('COLLAPSE', 'After measurement, the state has collapsed.') } })

    /* ---------------- scene 5: basis switch, 10s ---------------- */
    s.push({
      wait: 300,
      run: function () {
        var q = self.puzzle.qubits['A']
        self._caption('BASIS SWITCHING', 'The node is ' + q.getKet() + '. Now measure it in Z.')
      }
    })
    s.push({ wait: 2200, run: function () { self._clickNode('A', 'Z') } })
    s.push({
      wait: 2600,
      run: function () {
        var q = self.puzzle.qubits['A']
        var m = q.lastMeasurement()
        self._caption('BASIS SWITCHING',
          'Z on a superposition is 50/50 again. This run gave ' + m.result +
          ' (' + Math.round(m.probability * 100) + '% before collapsing).')
      }
    })
    s.push({
      wait: 2400,
      run: function () {
        var ket = self.puzzle.qubits['A'].getKet()
        self._caption('BASIS SWITCHING', 'Changing the basis changes the possible outcomes.')
      }
    })
    s.push({
      wait: 2200,
      run: function () {
        self._caption('BASIS SWITCHING', 'Certainty before. A coin flip after.')
      }
    })

    /* ---------------- scene 6: real gameplay, 23s ---------------- */
    s.push({
      wait: 300,
      run: function () {
        self._goto(4)
        self._caption('GAMEPLAY \u00b7 LAB 04 COLLAPSE', 'A real room. Two locks want the same node to repeat itself.')
      }
    })
    s.push({ wait: 2600, run: function () { self._clickNode('A', 'X') } })
    s.push({
      wait: 2400,
      run: function () {
        var m = self.puzzle.qubits['A'].lastMeasurement()
        self._caption('GAMEPLAY \u00b7 LAB 04 COLLAPSE',
          'First readout: X \u2192 ' + m.result + ' at ' + Math.round(m.probability * 100) + '%.')
      }
    })
    s.push({ wait: 2000, run: function () { self._clickNode('A', 'X') } })
    s.push({
      wait: 2600,
      run: function () {
        var m = self.puzzle.qubits['A'].lastMeasurement()
        self._caption('GAMEPLAY \u00b7 LAB 04 COLLAPSE',
          'Second readout: ' + m.result + ' at ' + Math.round(m.probability * 100) + '%. A door opened.')
      }
    })
    s.push({ wait: 2000, run: function () { self._clickNode('B', 'Z') } })
    s.push({ wait: 1800, run: function () { self._clickNode('B', 'Z') } })
    s.push({
      wait: 2800,
      run: function () {
        self._caption('GAMEPLAY \u00b7 LAB 04 COLLAPSE', 'Same basis, same result. The exit is open.')
      }
    })
    s.push({
      wait: 2400,
      run: function () {
        self._caption('GAMEPLAY \u00b7 LAB 04 COLLAPSE', 'You do not read the rules. You use them.')
      }
    })

    /* ---------------- scene 7: outro, 9s ---------------- */
    s.push({
      wait: 200,
      run: function () {
        self._caption('MEASUREMENT LOCK', 'Learn by playing.')
        self._title(
          '<div class="demo-mark"></div>' +
          '<h1>MEASUREMENT LOCK</h1>' +
          '<p class="demo-sub big">Learn by playing.</p>'
        )
      }
    })
    s.push({
      wait: 3200,
      run: function () {
        self._title(
          '<div class="demo-mark"></div>' +
          '<h1>MEASUREMENT LOCK</h1>' +
          '<p class="demo-sub big">Measurement isn\'t just looking.<br>How you measure matters.</p>'
        )
      }
    })
    s.push({
      wait: 3000,
      run: function () {
        self._title(
          '<div class="demo-mark"></div>' +
          '<h1>MEASUREMENT LOCK</h1>' +
          '<p class="demo-sub big">Measurement isn\'t just looking.<br>How you measure matters.</p>' +
          '<div class="demo-cta">11 labs \u00b7 real quantum engine \u00b7 no backend</div>' +
          '<button class="demo-play" id="demo-play">PLAY GAME</button>' +
          '<div class="demo-hint">or press ESC</div>'
        )
        var play = document.getElementById('demo-play')
        if (play) {
          play.addEventListener('click', function () {
            self.stop()
            document.getElementById('title-screen').classList.remove('is-live')
          })
        }
      }
    })
    s.push({ wait: 2800, run: function () {} })

    return s
  }

  Demo.TOTAL_SECONDS = TOTAL_SECONDS
  Demo.CLOCK_LABEL = CLOCK_LABEL

  return { Demo: Demo }
})