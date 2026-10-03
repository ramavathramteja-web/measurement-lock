/*
 * game/puzzle.js — the runtime for one level.
 *
 * Owns live Qubit instances, evaluates the lock/door/switch rules from
 * game/levels.js, and emits events for the UI. No DOM access here either.
 *
 * Design rules that keep every lab solvable:
 *   - a lock only reacts to measurements made while it is *armed* (all of its
 *     `requires` already satisfied), which is what enforces ordering;
 *   - a lock that wants one exact answer is only reachable once a gate has
 *     prepared that state, and gates are always reversible;
 *   - random answers open a branch rather than a dead end.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign({}, require('../quantum/qubit.js'), require('../quantum/register.js')),
      require('./gameState.js')
    )
  } else {
    root.ML = root.ML || {}
    var g = root.ML.game = root.ML.game || {}
    var api = factory(root.ML.quantum, g)
    g.Puzzle = api.Puzzle
    g.GATE_LABELS = api.GATE_LABELS
  }
})(typeof self !== 'undefined' ? self : globalThis, function (quantum, game) {
  'use strict'

  var Qubit = quantum.Qubit
  var Emitter = game.Emitter

  var GATE_LABELS = {
    H: 'H GATE',
    PHASE: 'PHASE INVERTER',
    NOT: 'FLIP GATE',
    REINIT: 'RE-INIT COIL',
    REPREP: 'RE-PREPARE COIL',
    SURVEY: 'SPECTROMETER'
  }

  var REGISTER_KET = {
    '0': '|0\u27e9',
    '1': '|1\u27e9',
    '+': '|+\u27e9',
    '-': '|\u2212\u27e9',
    '\u03c8': '|\u03c8\u27e9',
    'mixed': 'MIXED'
  }

  /**
   * A node backed by one qubit of a shared Register.
   *
   * It implements the same surface as Qubit, so every lock kind, the renderer
   * and the controls work unchanged. It deliberately exposes no `_a`/`_b`: an
   * entangled qubit has no pure amplitudes of its own, and pretending
   * otherwise is exactly the lie this lab exists to prevent.
   */
  function makeRegisterNode (reg, index, id) {
    return {
      _reg: reg,
      _index: index,
      _id: id,
      _registerNode: true,

      getId: function () { return id },
      getState: function () { return reg.singleQubitState(index) },
      getKet: function () { return REGISTER_KET[reg.singleQubitState(index)] || 'MIXED' },
      getAsciiKet: function () { return this.getKet() },
      getInitialState: function () { return '\u03c8' },
      isBasisState: function () { return reg.singleQubitState(index) !== 'mixed' },
      isDeterministicIn: function (basis) { return reg.isDeterministicIn(index, basis) },
      probabilities: function (basis) { return reg.probabilities(index, basis) },
      probability: function (basis, result) { return reg.probability(index, basis, result) },
      blochCoords: function () { return reg.blochCoords(index) },
      measure: function (basis) { return reg.measure(index, basis) },
      getMeasurementHistory: function () { return reg.getMeasurementHistoryFor(index) },
      getMeasurementHistoryIn: function (basis) { return reg.getMeasurementHistoryFor(index, basis) },
      lastMeasurement: function () {
        var h = this.getMeasurementHistory()
        return h.length ? h[h.length - 1] : null
      },
      getHistory: function () { return reg.getHistory() },
      getGateHistory: function () { return reg.getGateHistory() },
      clearHistory: function () { return this },
      reset: function () { return this }
    }
  }

  /**
   * @param {object} level a level definition from game/levels.js
   * @param {object} [options]
   * @param {function} [options.rng=Math.random]
   */
  function Puzzle (level, options) {
    Emitter.call(this)
    options = options || {}
    this.def = level
    this._rng = options.rng || Math.random
    this.build()
  }

  Puzzle.prototype = Object.create(Emitter.prototype)
  Puzzle.prototype.constructor = Puzzle

  /* ------------------------------------------------------------------ *
   * Construction / reset
   * ------------------------------------------------------------------ */

  Puzzle.prototype.build = function () {
    var self = this
    this.qubits = {}
    this.locks = {}
    this.doors = {}
    this.switches = {}
    this.devices = {}
    this.events = []
    this.selected = null
    this.complete = false
    this.isRegister = !!this.def.register
    this.registerRef = null

    this.def.nodes.forEach(function (n) {
      if (self.isRegister) return
      var q = new Qubit(n.state, { rng: self._rng, id: n.id })
      self.qubits[n.id] = q
    })

    // a register-backed room shares one state vector across all of its nodes
    if (this.isRegister) {
      var spec = this.def.register
      this.registerRef = new quantum.Register(spec.qubits, { rng: this._rng })
      var groups = (spec.pairs || []).map(function (pair) {
        return pair.map(function (id) { return self.nodeIndex(id) })
      })
      if (spec.prepare === 'BELL' && groups.length) {
        this.registerRef.repreparePairs(groups)
      }
      this.def.nodes.forEach(function (n) {
        self.qubits[n.id] = makeRegisterNode(self.registerRef, self.nodeIndex(n.id), n.id)
      })
    }

    this.def.locks.forEach(function (l) {
      self.locks[l.id] = {
        id: l.id,
        def: l,
        satisfied: false,
        armed: false,
        block: ''
      }
    })

    this.def.doors.forEach(function (d) {
      self.doors[d.id] = {
        id: d.id,
        def: d,
        open: false,
        everOpen: false
      }
    })

    this.def.switches.forEach(function (s) {
      self.switches[s.id] = {
        id: s.id,
        def: s,
        powered: false,
        enabled: false
      }
    })

    ;(this.def.devices || []).forEach(function (d) {
      self.devices[d.id] = { id: d.id, def: d, uses: 0 }
    })

    this.select(this.firstUnlockedNode())
    this.emit('rebuild', { level: this.def })
    return this
  }

  Puzzle.prototype.load = function (level) {
    this.def = level
    return this.build()
  }

  Puzzle.prototype.reset = function () {
    this.build()
    this.emit('reset', { level: this.def })
    return this
  }

  /* ------------------------------------------------------------------ *
   * Queries
   * ------------------------------------------------------------------ */

  Puzzle.prototype.lockList = function () {
    return this.def.locks.map(function (l) { return this.locks[l.id] }, this)
  }

  Puzzle.prototype.doorList = function () {
    return this.def.doors.map(function (d) { return this.doors[d.id] }, this)
  }

  Puzzle.prototype.switchList = function () {
    return this.def.switches.map(function (s) { return this.switches[s.id] }, this)
  }

  Puzzle.prototype.deviceList = function () {
    return (this.def.devices || []).map(function (d) { return this.devices[d.id] }, this)
  }

  Puzzle.prototype.nodeDef = function (id) {
    var list = this.def.nodes
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
    return null
  }

  /** Qubit index of a node inside the shared register. */
  Puzzle.prototype.nodeIndex = function (id) {
    var list = this.def.nodes
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i
    return null
  }

  /** The register's global description, e.g. 'ENTANGLED'. */
  Puzzle.prototype.registerState = function () {
    if (!this.registerRef || !this.registerRef.ketString) return null
    return this.registerRef.ketString()
  }

  Puzzle.prototype.isArmed = function (lockId) {
    var l = this.locks[lockId]
    if (!l) return false
    var req = l.def.requires || []
    for (var i = 0; i < req.length; i++) {
      if (!this.locks[req[i]] || !this.locks[req[i]].satisfied) return false
    }
    return true
  }

  Puzzle.prototype.isNodeLocked = function (nodeId) {
    var def = this.nodeDef(nodeId)
    if (!def) return true
    if (!def.locked) return false
    return !this.isNodeUnlocked(nodeId)
  }

  Puzzle.prototype.isNodeUnlocked = function (nodeId) {
    var list = this.switchList()
    for (var i = 0; i < list.length; i++) {
      if (list[i].powered && (list[i].def.unlocks || []).indexOf(nodeId) !== -1) return true
    }
    return false
  }

  Puzzle.prototype.firstUnlockedNode = function () {
    var list = this.def.nodes
    for (var i = 0; i < list.length; i++) {
      if (!this.isNodeLocked(list[i].id)) return list[i].id
    }
    return list.length ? list[0].id : null
  }

  Puzzle.prototype.select = function (nodeId) {
    if (nodeId && !this.qubits[nodeId]) return this.selected
    this.selected = nodeId
    this.emit('select', { nodeId: nodeId })
    return this.selected
  }

  Puzzle.prototype.selectNext = function (delta) {
    var list = this.def.nodes
    if (!list.length) return null
    var i = 0
    for (var j = 0; j < list.length; j++) if (list[j].id === this.selected) i = j
    i = (i + (delta || 1) + list.length) % list.length
    return this.select(list[i].id)
  }

  /** Snapshot used by the renderer. */
  Puzzle.prototype.getSnapshot = function () {
    var self = this
    return {
      level: this.def,
      selected: this.selected,
      complete: this.complete,
      nodes: this.def.nodes.map(function (n) {
        var q = self.qubits[n.id]
        return {
          id: n.id,
          label: n.label,
          def: n,
          qubit: q,
          state: q.getState(),
          ket: q.getKet(),
          asciiKet: q.getAsciiKet(),
          locked: self.isNodeLocked(n.id),
          selected: self.selected === n.id,
          devices: (self.def.devices || []).filter(function (d) { return d.node === n.id }),
          measurements: q.getMeasurementHistory().length
        }
      }),
      locks: this.lockList().map(function (l) {
        return {
          id: l.id,
          def: l.def,
          label: l.def.label,
          kind: l.def.kind,
          satisfied: l.satisfied,
          armed: self.isArmed(l.id),
          blockedBy: self._blockersOf(l.id)
        }
      }),
      doors: this.doorList().map(function (d) {
        return { id: d.id, def: d.def, open: d.open, label: d.def.label, exit: !!d.def.exit }
      }),
      switches: this.switchList().map(function (s) {
        return {
          id: s.id,
          def: s.def,
          label: s.def.label,
          powered: s.powered,
          enabled: s.enabled,
          blockedBy: self._blockers(s)
        }
      }),
      events: this.events.slice()
    }
  }

  /* ------------------------------------------------------------------ *
   * Measurement
   * ------------------------------------------------------------------ */

  /**
   * Measure a node in a basis.
   * @returns {object|null} { nodeId, basis, result, probability, state } or null if blocked
   */
  Puzzle.prototype.measure = function (nodeId, basis) {
    if (this.isRegister) return this._measureRegister(nodeId, basis)
    if (!nodeId) nodeId = this.selected
    var q = this.qubits[nodeId]
    if (!q) return null

    if (this.isNodeLocked(nodeId)) {
      this.emit('blocked', { nodeId: nodeId, reason: 'NO POWER \u2014 ' + (this.nodeDef(nodeId) || {}).label })
      return null
    }

    var stateBefore = q.getState()
    var predicted = q.probabilities(basis)
    var result = q.measure(basis)
    var probability = predicted[result]

    var ev = {
      seq: this.events.length + 1,
      type: 'measure',
      nodeId: nodeId,
      basis: basis,
      result: result,
      probability: probability,
      stateBefore: stateBefore,
      stateAfter: q.getState(),
      ket: q.getKet()
    }
    this.events.push(ev)

    this.emit('measure', ev)

    var opened = this._evaluateAll(nodeId, basis)
    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()

    return {
      nodeId: nodeId,
      basis: basis,
      result: result,
      probability: probability,
      state: q.getState(),
      ket: q.getKet(),
      certain: probability > 0.999999,
      openedLocks: opened,
      openedDoors: openedDoors
    }
  }

  Puzzle.prototype.measureZ = function (nodeId) { return this.measure(nodeId, 'Z') }
  Puzzle.prototype.measureX = function (nodeId) { return this.measure(nodeId, 'X') }

  /** Same contract as measure(), for a room backed by a shared register. */
  Puzzle.prototype._measureRegister = function (nodeId, basis) {
    if (!nodeId) nodeId = this.selected
    var index = this.nodeIndex(nodeId)
    if (index === null) return null

    if (this.isNodeLocked(nodeId)) {
      this.emit('blocked', { nodeId: nodeId, reason: 'NO POWER \u2014 ' + ((this.nodeDef(nodeId) || {}).label || nodeId) })
      return null
    }

    var reg = this.registerRef
    var ketBefore = reg.ketString()
    var predicted = reg.probabilities(index, basis)
    var result = reg.measure(index, basis)
    var probability = predicted[result]

    var ev = {
      seq: this.events.length + 1,
      type: 'measure',
      nodeId: nodeId,
      basis: basis,
      result: result,
      probability: probability,
      stateBefore: ketBefore,
      stateAfter: reg.ketString(),
      ket: REGISTER_KET[reg.singleQubitState(index)] || 'MIXED'
    }
    this.events.push(ev)
    this.emit('measure', ev)

    var opened = this._evaluateAll(nodeId, basis)
    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()

    return {
      nodeId: nodeId,
      basis: basis,
      result: result,
      probability: probability,
      state: reg.singleQubitState(index),
      ket: REGISTER_KET[reg.singleQubitState(index)] || 'MIXED',
      register: reg.ketString(),
      certain: probability > 0.999999,
      openedLocks: opened,
      openedDoors: openedDoors
    }
  }

  /* ------------------------------------------------------------------ *
   * Devices (gates) and switches
   * ------------------------------------------------------------------ */

  Puzzle.prototype.applyDevice = function (deviceId) {
    var entry = this.devices[deviceId]
    if (!entry) return null
    var def = entry.def
    var q = this.qubits[def.node]
    var index = def.node ? this.nodeIndex(def.node) : null

    if (def.type === 'REPREP') {
      return this._reprepare(entry, def)
    }

    if (def.type === 'SURVEY') {
      return this._survey(entry, def)
    }

    if (!q) return null

    if (this.isNodeLocked(def.node)) {
      this.emit('blocked', { nodeId: def.node, reason: 'NO POWER ON ' + (this.nodeDef(def.node) || {}).label })
      return null
    }

    var before = q.getState()
    if (this.isRegister) {
      var reg = this.registerRef
      if (def.type === 'H') reg.hadamard(index)
      else if (def.type === 'PHASE') reg.phaseFlip(index)
      else if (def.type === 'NOT') reg.not(index)
      else if (def.type === 'REINIT') reg.reset()
      else {
        this.emit('blocked', { nodeId: def.node, reason: 'UNKNOWN DEVICE' })
        return null
      }
      before = reg.ketString()
    } else {
      switch (def.type) {
        case 'H': q.hadamard(); break
        case 'PHASE': q.phaseFlip(); break
        case 'NOT': q.not(); break
        case 'REINIT': q.reset(); break
        default:
          this.emit('blocked', { nodeId: def.node, reason: 'UNKNOWN DEVICE' })
          return null
      }
    }
    entry.uses++

    var after = this.isRegister
      ? reg.singleQubitState(index)
      : q.getState()

    var ev = {
      seq: this.events.length + 1,
      type: 'gate',
      deviceId: deviceId,
      deviceLabel: def.label,
      gateLabel: GATE_LABELS[def.type] || def.type,
      nodeId: def.node,
      stateBefore: before,
      stateAfter: after,
      ket: this.isRegister ? REGISTER_KET[after] || 'MIXED' : q.getKet(),
      register: this.isRegister ? this.registerRef.ketString() : null
    }
    this.events.push(ev)
    this.emit('gate', ev)

    var opened = this._evaluateGateLocks(deviceId, def.node)
    opened = opened.concat(this._evaluateAll(def.node, null))
    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()

    return { device: def, openedLocks: opened, openedDoors: openedDoors, state: q.getState() }
  }

  /** Re-run a lab preparation for the register (or one group of it). */
  Puzzle.prototype._reprepare = function (entry, def) {
    if (!this.isRegister) return null
    var self = this
    var reg = this.registerRef
    var pairs = (this.def.register.pairs || []).map(function (pair) {
      return pair.map(function (id) { return self.nodeIndex(id) })
    })

    // split the named qubits into their groups, then rebuild them together so
    // re-preparing one pair never erases another
    var wanted = def.qubits || []
    var groups = pairs.filter(function (g) {
      return g.every(function (i) { return wanted.indexOf(self.def.nodes[i].id) !== -1 })
    })
    if (!groups.length) groups = pairs

    var before = reg.ketString()
    reg.repreparePairs(groups)
    entry.uses++

    var ev = {
      seq: this.events.length + 1,
      type: 'gate',
      deviceId: def.id,
      deviceLabel: def.label,
      gateLabel: GATE_LABELS.REPREP,
      nodeId: (def.qubits || [])[0] || null,      stateBefore: before,
      stateAfter: reg.ketString(),
      ket: reg.ketString(),
      register: reg.ketString()
    }
    this.events.push(ev)
    this.emit('gate', ev)

    var opened = this._evaluateGateLocks(def.id, (def.qubits || [])[0])
    opened = opened.concat(this._evaluateAll((def.qubits || [])[0], null))
    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()
    return { device: def, openedLocks: opened, openedDoors: openedDoors, state: reg.ketString() }
  }

  /**
   * The spectrometer: gather statistics about a node by reading it many times.
   *
   * Each trial re-prepares the sample from its starting state, because a qubit
   * cannot be cloned - that is exactly how a real bench measures a
   * distribution. The sample is left collapsed on the final reading, so the
   * player pays for the evidence with the state they were holding.
   */
  Puzzle.prototype._survey = function (entry, def) {
    var q = this.qubits[def.node]
    if (!q) return null
    if (this.isNodeLocked(def.node)) {
      this.emit('blocked', { nodeId: def.node, reason: 'NO POWER ON ' + ((this.nodeDef(def.node) || {}).label || def.node) })
      return null
    }

    var trials = def.trials || 12
    var basis = def.basis || 'X'
    var counts = {}
    var last = null
    for (var t = 0; t < trials; t++) {
      q.reset()
      last = q.measure(basis)
      counts[last] = (counts[last] || 0) + 1
    }
    entry.uses++

    var ev = {
      seq: this.events.length + 1,
      type: 'survey',
      deviceId: def.id,
      deviceLabel: def.label,
      gateLabel: GATE_LABELS.SURVEY,
      nodeId: def.node,
      basis: basis,
      trials: trials,
      counts: counts,
      result: last,
      stateAfter: q.getState(),
      ket: q.getKet()
    }
    this.events.push(ev)
    this.emit('survey', ev)

    var opened = this._evaluateGateLocks(def.id, def.node)
    opened = opened.concat(this._evaluateAll(def.node, basis))
    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()
    return { device: def, counts: counts, trials: trials, openedLocks: opened, openedDoors: openedDoors }
  }

  Puzzle.prototype.flipSwitch = function (switchId) {
    var s = this.switches[switchId]
    if (!s) return null
    if (!s.enabled) {
      this.emit('blocked', { nodeId: null, reason: s.def.label + ' HAS NO POWER YET' })
      return null
    }
    if (s.powered) return null

    s.powered = true
    this.emit('switch', { id: switchId, def: s.def, powered: true, unlocks: s.def.unlocks || [] })

    var unlocked = (s.def.unlocks || []).filter(function (id) { return true })
    if (!this.selected || this.isNodeLocked(this.selected)) {
      this.select(unlocked[0] || this.selected)
    }

    this._refreshSwitches()
    var openedDoors = this._refreshDoors()
    this._checkComplete()
    return { switch: s, unlocked: unlocked, openedDoors: openedDoors }
  }

  /* ------------------------------------------------------------------ *
   * Lock evaluation
   * ------------------------------------------------------------------ */

  Puzzle.prototype._blockersOf = function (lockId) {
    var l = this.locks[lockId]
    if (!l) return []
    var self = this
    return (l.def.requires || []).filter(function (id) {
      return !self.locks[id] || !self.locks[id].satisfied
    })
  }

  Puzzle.prototype._blockers = function (sw) {
    var self = this
    return (sw.def.requires || []).filter(function (id) {
      return !self.locks[id] || !self.locks[id].satisfied
    })
  }

  Puzzle.prototype._refreshSwitches = function () {
    var self = this
    this.switchList().forEach(function (s) {
      s.enabled = self._blockers(s).length === 0
    })
  }

  Puzzle.prototype._evaluateLocks = function (nodeId, basis) {
    var self = this
    var opened = []
    var changed = true
    var guard = 0

    while (changed && guard++ < 16) {
      changed = false
      this.lockList().forEach(function (l) {
        if (l.satisfied || !self.isArmed(l.id)) return
        var d = l.def
        if (d.kind !== 'readout' && d.kind !== 'echo') return
        if (d.node !== nodeId || d.basis !== basis) return
        if (!self._testLock(l)) return

        l.satisfied = true
        changed = true
        opened.push(l)
        self.emit('lock', { id: l.id, def: d, label: d.label, kind: d.kind, nodeId: d.node })

        if (d.branch) {
          var last = self.qubits[nodeId].lastMeasurement()
          var doorId = last ? d.branch[last.result] : null
          if (doorId && self.doors[doorId]) {
            self.doors[doorId].open = true
            self.doors[doorId].everOpen = true
            self.emit('branch', { doorId: doorId, result: last.result, nodeId: nodeId })
          }
        }
      })
    }

    return opened
  }

  /**
   * A "state" lock fires the moment a node *is* the required ket. It is checked
   * after every action on that node, because gates can move a node into or out
   * of the state just as a readout can.
   */
    /**
   * Evaluate every lock kind for one action, repeatedly, until nothing more
   * fires. A single action can satisfy a state lock and arm a readout lock at
   * the same moment, so a single pass would leave that readout unevaluated
   * until the player pressed something else.
   */
  Puzzle.prototype._evaluateAll = function (nodeId, basis) {
    var opened = []
    var guard = 0
    while (guard++ < 32) {
      var before = opened.length
      opened = opened.concat(this._evaluateLocks(nodeId, basis))
      opened = opened.concat(this._evaluateMatchLocks(nodeId, basis))
      opened = opened.concat(this._evaluateStateLocks(nodeId))
      if (opened.length === before) break
    }
    return opened
  }

  Puzzle.prototype._evaluateStateLocks = function (nodeId) {
    var self = this
    var opened = []
    this.lockList().forEach(function (l) {
      if (l.satisfied || !self.isArmed(l.id)) return
      var d = l.def
      if (d.kind !== 'state' || d.node !== nodeId) return
      var q = self.qubits[d.node]
      if (!q || q.getState() !== d.state) return
      l.satisfied = true
      opened.push(l)
      self.emit('lock', { id: l.id, def: d, label: d.label, kind: d.kind, nodeId: d.node })
    })
    return opened
  }

  /**
   * A "match" lock fires when this node's latest readout in a basis equals
   * another node's latest readout in the same basis.
   */
  Puzzle.prototype._evaluateMatchLocks = function (nodeId, basis) {
    var self = this
    var opened = []
    this.lockList().forEach(function (l) {
      if (l.satisfied || !self.isArmed(l.id)) return
      var d = l.def
      if (d.kind !== 'match' || d.node !== nodeId || d.basis !== basis) return
      var mine = self.qubits[d.node].lastMeasurement()
      var theirs = self.qubits[d.other].lastMeasurement()
      if (!mine || !theirs) return
      if (mine.basis !== basis || theirs.basis !== basis) return
      if (mine.result !== theirs.result) return
      l.satisfied = true
      opened.push(l)
      self.emit('lock', { id: l.id, def: d, label: d.label, kind: d.kind, nodeId: d.node })
    })
    return opened
  }

  Puzzle.prototype._evaluateGateLocks = function (deviceId, nodeId) {
    var self = this
    var opened = []
    this.lockList().forEach(function (l) {
      if (l.satisfied || !self.isArmed(l.id)) return
      var d = l.def
      if (d.kind !== 'gate') return
      if (d.device && d.device !== deviceId) return
      if (d.node && d.node !== nodeId) return
      l.satisfied = true
      opened.push(l)
      self.emit('lock', { id: l.id, def: d, label: d.label, kind: d.kind, nodeId: d.node })
    })
    return opened
  }

  Puzzle.prototype._testLock = function (lock) {
    var d = lock.def
    var q = this.qubits[d.node]
    if (!q) return false

    if (d.kind === 'readout') {
      var last = q.lastMeasurement()
      if (!last || last.basis !== d.basis) return false
      return (d.accept || []).indexOf(last.result) !== -1
    }

    if (d.kind === 'echo') {
      var need = d.count || 2
      var hist = q.getMeasurementHistoryIn(d.basis)
      if (hist.length < need) return false
      var tail = hist.slice(hist.length - need)
      for (var i = 1; i < tail.length; i++) {
        if (tail[i].result !== tail[0].result) return false
      }
      return true
    }

    return false
  }

  /* ------------------------------------------------------------------ *
   * Doors / completion
   * ------------------------------------------------------------------ */

  /**
   * A door condition may name either a lock or another door, so that a branch
   * route (a door opened by a random result) can satisfy a downstream exit.
   */
  Puzzle.prototype._isSatisfied = function (id) {
    if (this.locks[id]) return this.locks[id].satisfied
    if (this.doors[id]) return this.doors[id].open
    return false
  }

  Puzzle.prototype._refreshDoors = function () {
    var self = this
    var opened = []

    this.doorList().forEach(function (d) {
      if (d.open) return
      var def = d.def
      var all = (def.locks || []).every(function (id) { return self._isSatisfied(id) })
      var anyOk
      if ((def.anyLocks || []).length) {
        anyOk = def.anyLocks.some(function (id) { return self._isSatisfied(id) })
      } else {
        anyOk = (def.locks || []).length > 0
      }
      if (all && anyOk) {
        d.open = true
        d.everOpen = true
        opened.push(d)
        self.emit('door', { id: d.id, def: def, label: def.label, exit: !!def.exit })
      }
    })

    return opened
  }

  Puzzle.prototype.doorStatus = function (doorId) {
    var d = this.doors[doorId]
    if (!d) return { open: false, missing: [] }
    var missing = (d.def.locks || []).filter(function (id) { return !this._isSatisfied(id) }, this)
    if ((d.def.anyLocks || []).length) {
      var anyOk = d.def.anyLocks.some(function (id) { return this._isSatisfied(id) }, this)
      if (!anyOk) missing = missing.concat(['one of: ' + d.def.anyLocks.join(' / ')])
    }
    return { open: d.open, missing: missing }
  }

  Puzzle.prototype.exitOpen = function () {
    var list = this.def.doors.filter(function (d) { return d.exit })
    if (!list.length) return this.def.locks.every(function (l) { return true })
    return list.every(function (d) { return this.doors[d.id] && this.doors[d.id].open }, this)
  }

  Puzzle.prototype.objectivesLeft = function () {
    return this.lockList().filter(function (l) { return !l.satisfied }).length
  }

  Puzzle.prototype._checkComplete = function () {
    if (this.complete) return true
    if (!this.exitOpen()) return false
    this.complete = true
    this.emit('complete', { level: this.def })
    return true
  }

  return { Puzzle: Puzzle, GATE_LABELS: GATE_LABELS }
})
