/*
 * ui/controls.js — input only.
 *
 * Listens for clicks on the room (nodes, gates, switches) and for the global
 * control bar, plus optional keyboard shortcuts. It forwards intent to the
 * Puzzle and never touches quantum state itself.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var ui = root.ML.ui = root.ML.ui || {}
    ui.Controls = factory().Controls
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.room
   * @param {HTMLElement} opts.stage
   * @param {object} opts.puzzle
   * @param {object} opts.renderer
   * @param {object} opts.gameState
   * @param {function} opts.onReset
   * @param {function} opts.onNext
   * @param {function} opts.onPrevious
   */
  function Controls (opts) {
    var self = this
    this.opts = opts
    this.puzzle = opts.puzzle
    this.renderer = opts.renderer
    this.room = opts.room
    this.stage = opts.stage
    // optional predicate: while it returns true, keyboard input is ignored
    this.isBlocked = opts.isBlocked || null

    var dom = this.renderer.dom

    // --- room: node selection, per-node measure, devices, switches ---------
    this.room.addEventListener('click', function (ev) {
      var target = ev.target.closest('[data-device],[data-switch],[data-measure],[data-node]')
      if (!target) return
      ev.preventDefault()

      if (target.dataset.device) {
        self.puzzle.applyDevice(target.dataset.device)
        return
      }
      if (target.dataset.switch) {
        self.puzzle.flipSwitch(target.dataset.switch)
        return
      }
      if (target.dataset.measure) {
        self.puzzle.select(target.dataset.node)
        self.puzzle.measure(target.dataset.node, target.dataset.measure)
        return
      }
      if (target.dataset.node) {
        self.puzzle.select(target.dataset.node)
      }
    })

    // --- global control bar ------------------------------------------------
    dom.btnMeasureZ.addEventListener('click', function () {
      self.puzzle.measure(self.puzzle.selected, 'Z')
    })
    dom.btnMeasureX.addEventListener('click', function () {
      self.puzzle.measure(self.puzzle.selected, 'X')
    })
    dom.btnReset.addEventListener('click', function () { self.opts.onReset() })
    dom.btnNext.addEventListener('click', function () { self.opts.onNext() })
    dom.btnPrev.addEventListener('click', function () { self.opts.onPrevious() })

    // --- keyboard ----------------------------------------------------------
    this._onKey = function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      var k = ev.key.toLowerCase()
      var puzzle = self.puzzle

      // while the main menu is up, only Escape/Enter mean anything
      if (self.isBlocked && self.isBlocked()) {
        if (k === 'enter' && ev.target && ev.target.id === 'title-play') ev.target.click()
        return
      }

      if (k === 'z') { puzzle.measure(puzzle.selected, 'Z'); ev.preventDefault() }
      else if (k === 'x') { puzzle.measure(puzzle.selected, 'X'); ev.preventDefault() }
      else if (k === 'r') { self.opts.onReset() }
      else if (k === 'n' || k === 'enter') { self.opts.onNext() }
      else if (k === 'p') { self.opts.onPrevious() }
      else if (k === 'q' || k === 'arrowright') { puzzle.selectNext(1) }
      else if (k === 'a' || k === 'arrowleft') { puzzle.selectNext(-1) }
      else if (k === 'h') { self._deviceForSelected('H') }
      else if (k === 'g') { self._deviceForSelected('PHASE') }
      else if (k === 'u') { self._deviceForSelected('REINIT') }
      else if (k >= '1' && k <= '9') {
        var nodes = puzzle.def.nodes
        var i = parseInt(k, 10) - 1
        if (nodes[i]) puzzle.select(nodes[i].id)
      }
    }
    window.addEventListener('keydown', this._onKey)
  }

  Controls.prototype._deviceForSelected = function (type) {
    var puzzle = this.puzzle
    var devices = (puzzle.def.devices || []).filter(function (d) {
      return d.node === puzzle.selected && d.type === type
    })
    if (devices[0]) puzzle.applyDevice(devices[0].id)
  }

  Controls.prototype.destroy = function () {
    window.removeEventListener('keydown', this._onKey)
  }

  return { Controls: Controls }
})
