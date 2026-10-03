/*
 * game/gameState.js — run-wide state: which level we are in, what has been
 * unlocked, and lifetime lab statistics. Also exports the tiny event emitter
 * shared by the puzzle and the UI.
 *
 * No DOM access here.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var api = factory()
    var g = root.ML.game = root.ML.game || {}
    g.Emitter = api.Emitter
    g.GameState = api.GameState
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  /** Minimal synchronous event emitter. */
  function Emitter () {
    this._handlers = {}
  }

  Emitter.prototype.on = function (event, fn) {
    ;(this._handlers[event] = this._handlers[event] || []).push(fn)
    return this
  }

  Emitter.prototype.off = function (event, fn) {
    var list = this._handlers[event]
    if (!list) return this
    var i = list.indexOf(fn)
    if (i !== -1) list.splice(i, 1)
    return this
  }

  Emitter.prototype.emit = function (event, payload) {
    var list = this._handlers[event]
    if (list) {
      for (var i = 0; i < list.length; i++) list[i](payload)
    }
    var any = this._handlers['*']
    if (any) {
      for (var j = 0; j < any.length; j++) any[j](event, payload)
    }
    return this
  }

  /**
   * Owns level progression for one play-through.
   * @param {Array} levels the level table (from game/levels.js)
   */
  function GameState (levels) {
    Emitter.call(this)
    this.levels = levels || []
    this.index = 0
    this.completed = {}
    this.stats = { measurements: 0, certain: 0, probabilistic: 0, collapses: 0, gates: 0, resets: 0 }
  }

  GameState.prototype = Object.create(Emitter.prototype)
  GameState.prototype.constructor = GameState

  Object.defineProperty(GameState.prototype, 'levelCount', {
    get: function () { return this.levels.length }
  })

  Object.defineProperty(GameState.prototype, 'level', {
    get: function () { return this.levels[this.index] || null }
  })

  Object.defineProperty(GameState.prototype, 'levelNumber', {
    get: function () { return this.index + 1 }
  })

  GameState.prototype.isFirst = function () {
    return this.index <= 0
  }

  GameState.prototype.isLast = function () {
    return this.index >= this.levels.length - 1
  }

  GameState.prototype.hasNext = function () {
    return !this.isLast()
  }

  GameState.prototype.hasPrevious = function () {
    return !this.isFirst()
  }

  GameState.prototype.completedCount = function () {
    var self = this
    return this.levels.filter(function (l) { return !!self.completed[l.id] }).length
  }

  GameState.prototype.isCompleted = function (id) {
    return !!this.completed[id]
  }

  GameState.prototype.goTo = function (index, reason) {
    if (index < 0 || index >= this.levels.length) return false
    var changed = index !== this.index
    this.index = index
    this.emit('level:enter', { index: index, level: this.level, reason: reason || 'jump', changed: changed })
    this.save()
    return true
  }

  GameState.prototype.next = function () {
    if (!this.hasNext()) return false
    return this.goTo(this.index + 1, 'next')
  }

  GameState.prototype.previous = function () {
    if (!this.hasPrevious()) return false
    return this.goTo(this.index - 1, 'previous')
  }

  /** Restart the current level from its initial quantum state. */
  GameState.prototype.restartLevel = function () {
    this.stats.resets++
    this.emit('level:restart', { level: this.level, index: this.index })
  }

  /** Called by the puzzle when the exit door of a level opens. */
  GameState.prototype.completeLevel = function () {
    var level = this.level
    if (!level) return false
    var first = !this.completed[level.id]
    this.completed[level.id] = true
    this.emit('level:complete', { level: level, index: this.index, first: first })
    this.save()
    return true
  }

  GameState.prototype.recordMeasurement = function (probability) {
    this.stats.measurements++
    if (probability > 0.999999) this.stats.certain++
    else this.stats.probabilistic++
  }

  GameState.prototype.recordCollapse = function () {
    this.stats.collapses++
  }

  GameState.prototype.recordGate = function () {
    this.stats.gates++
  }

  GameState.prototype.resetProgress = function () {
    this.index = 0
    this.completed = {}
    this.stats = { measurements: 0, certain: 0, probabilistic: 0, collapses: 0, gates: 0, resets: 0 }
    this.emit('progress:reset', {})
  }

  /* -------------------------------------------------- progress memory
   *
   * Best effort only. A locked-down browser throws on localStorage access and
   * the game must still run, so every call is guarded.
   */

  GameState.STORAGE_KEY = 'measurement-lock/progress'

  GameState.prototype.save = function () {
    try {
      if (typeof localStorage === 'undefined') return false
      localStorage.setItem(GameState.STORAGE_KEY, JSON.stringify({
        index: this.index,
        completed: this.completed,
        stats: this.stats
      }))
      return true
    } catch (e) {
      return false
    }
  }

  GameState.prototype.load = function () {
    try {
      if (typeof localStorage === 'undefined') return false
      var raw = localStorage.getItem(GameState.STORAGE_KEY)
      if (!raw) return false
      var data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return false
      if (typeof data.index === 'number' && data.index >= 0 && data.index < this.levels.length) {
        this.index = data.index
      }
      if (data.completed && typeof data.completed === 'object') this.completed = data.completed
      if (data.stats && typeof data.stats === 'object') {
        var s = this.stats
        Object.keys(s).forEach(function (k) {
          if (typeof data.stats[k] === 'number') s[k] = data.stats[k]
        })
      }
      return true
    } catch (e) {
      return false
    }
  }

  GameState.prototype.clearSaved = function () {
    try {
      if (typeof localStorage === 'undefined') return false
      localStorage.removeItem(GameState.STORAGE_KEY)
      return true
    } catch (e) {
      return false
    }
  }

  return { Emitter: Emitter, GameState: GameState }
})
