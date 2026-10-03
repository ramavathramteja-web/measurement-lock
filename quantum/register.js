/*
 * quantum/register.js — a small multi-qubit state-vector simulator.
 *
 * Pure physics, no DOM, no game rules. Qubit.js stays the single-qubit engine
 * (and is still what the game uses for the first nine labs); this file exists
 * because a correlation lab needs more than one qubit at a time.
 *
 * State is a plain array of real amplitudes, one per basis state:
 *     |psi> = sum_k amp[k] |bits of k>
 * with qubit i stored as bit i of the index (bit 0 = qubit 0). Every gate used
 * here is real, so a single array of numbers is a complete description.
 *
 * Two qubits is all the game needs, but nothing below is hard coded to two.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    root.ML.quantum = root.ML.quantum || {}
    root.ML.quantum.Register = factory().Register
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  var SQRT1_2 = Math.SQRT1_2
  var EPS = 1e-9

  var Z_RESULTS = ['0', '1']
  var X_RESULTS = ['+', '-']

  var KET_CHAR = { '0': '0', '1': '1', '+': '+', '-': '\u2212' }
  var LABEL = { '0': '|0\u27e9', '1': '|1\u27e9', '+': '|+\u27e9', '-': '|\u2212\u27e9', '\u03c8': '|\u03c8\u27e9', 'mixed': 'MIXED' }

  /**
   * @param {number} count number of qubits
   * @param {object} [options]
   * @param {function} [options.rng=Math.random]
   */
  function Register (count, options) {
    if (!(this instanceof Register)) return new Register(count, options)
    options = options || {}
    if (!count || count < 1) throw new Error('quantum/register: needs at least one qubit')
    this._n = count
    this._size = 1 << count
    this._rng = typeof options.rng === 'function' ? options.rng : Math.random
    this._log = []
    this._setAllZero()
    this._resetTo = this._amp.slice()
  }

  /* ------------------------------------------------------------------ *
   * Plumbing
   * ------------------------------------------------------------------ */

  Register.prototype._setAllZero = function () {
    if (!this._amp || this._amp.length !== this._size) {
      this._amp = new Array(this._size)
    }
    this._clear()
    this._amp[0] = 1
  }

  Register.prototype._clear = function () {
    for (var i = 0; i < this._size; i++) this._amp[i] = 0
  }

  /** After a preparation: normalise and remember it as the reset target. */
  Register.prototype._prepare = function () {
    this._renormalise()
    this._resetTo = this._amp.slice()
    return this
  }

  Register.prototype.count = function () { return this._n }
  Register.prototype.size = function () { return this._size }
  Register.prototype.amp = function () { return this._amp.slice() }

  Register.prototype._bit = function (k, i) { return (k >> i) & 1 }
  Register.prototype._check = function (i) {
    if (typeof i !== 'number' || i < 0 || i >= this._n) {
      throw new Error('quantum/register: qubit index ' + i + ' is out of range (0..' + (this._n - 1) + ')')
    }
  }

  Register.prototype._renormalise = function () {
    var norm = 0
    for (var k = 0; k < this._size; k++) norm += this._amp[k] * this._amp[k]
    norm = Math.sqrt(norm)
    if (norm < EPS) { this._setAllZero(); return }
    for (var j = 0; j < this._size; j++) this._amp[j] /= norm
  }

  /* ------------------------------------------------------------------ *
   * State description
   * ------------------------------------------------------------------ */

  /** The basis-state ket if the register is a product state, else 'psi'. */
  Register.prototype.getState = function () {
    var labels = []
    for (var i = 0; i < this._n; i++) labels.push(this.singleQubitState(i))
    if (labels.indexOf('mixed') !== -1) return '\u03c8'
    return labels.join('')
  }

  /**
   * One qubit's own description. A qubit of an entangled pair has no pure ket,
   * which is reported honestly as 'mixed' rather than faked.
   * @returns {'0'|'1'|'+'|'-'|'mixed'}
   */
  Register.prototype.singleQubitState = function (i) {
    this._check(i)
    var pz = this.probabilitiesZ(i)
    if (pz['0'] > 1 - EPS) return '0'
    if (pz['1'] > 1 - EPS) return '1'
    var px = this.probabilitiesX(i)
    if (px['+'] > 1 - EPS) return '+'
    if (px['-'] > 1 - EPS) return '-'
    return 'mixed'
  }

  Register.prototype.ketOf = function (i) { return LABEL[this.singleQubitState(i)] || 'MIXED' }

  /** e.g. '|00\u27e9' for a product state, 'ENTANGLED' for anything else */
  Register.prototype.ketString = function () {
    if (this.isEntangled()) return 'ENTANGLED'
    var labels = []
    for (var i = 0; i < this._n; i++) {
      var s = this.singleQubitState(i)
      if (s === 'mixed') return 'ENTANGLED'
      labels.push(KET_CHAR[s])
    }
    return '|' + labels.join('') + '\u27e9'
  }

  /** True when the state cannot be written as a product of single qubits. */
  Register.prototype.isEntangled = function () {
    for (var i = 0; i < this._n; i++) {
      for (var j = i + 1; j < this._n; j++) {
        // a product state has <Zi Zj> = <Zi><Zj>; anything else means the
        // qubits are correlated and no separate description exists
        var zz = this.correlationZZ(i, j)
        var zi = this.expectationZ(i)
        var zj = this.expectationZ(j)
        if (Math.abs(zz - zi * zj) > 1e-9) return true
      }
    }
    return false
  }

  /* ------------------------------------------------------------------ *
   * Expectation values and probabilities
   * ------------------------------------------------------------------ */

  Register.prototype.expectationZ = function (i) {
    this._check(i)
    var s = 0
    for (var k = 0; k < this._size; k++) {
      s += this._amp[k] * this._amp[k] * (this._bit(k, i) ? -1 : 1)
    }
    return s
  }

  /** <Zi Zj> — 1 when the two qubits always agree, -1 when they always differ. */
  Register.prototype.correlationZZ = function (i, j) {
    this._check(i)
    this._check(j)
    var s = 0
    for (var k = 0; k < this._size; k++) {
      var sign = (this._bit(k, i) ? -1 : 1) * (this._bit(k, j) ? -1 : 1)
      s += this._amp[k] * this._amp[k] * sign
    }
    return s
  }

  /** Bloch coordinates of one qubit; the length is < 1 for a mixed qubit. */
  Register.prototype.blochCoords = function (i) {
    this._check(i)
    var bit = 1 << i
    // <Xi> = 2 * sum over half the indices, so each pair is counted once
    var x = 0
    for (var k = 0; k < this._size; k++) {
      if (k & bit) continue
      x += this._amp[k] * this._amp[k ^ bit]
    }
    x *= 2
    return { x: x, y: 0, z: this.expectationZ(i), r: Math.sqrt(x * x + Math.pow(this.expectationZ(i), 2)) }
  }

  Register.prototype.probabilitiesZ = function (i) {
    this._check(i)
    var p0 = 0
    for (var k = 0; k < this._size; k++) {
      if (!this._bit(k, i)) p0 += this._amp[k] * this._amp[k]
    }
    p0 = p0 < 0 ? 0 : (p0 > 1 ? 1 : p0)
    return { '0': p0, '1': 1 - p0 }
  }

  Register.prototype.probabilitiesX = function (i) {
    this._check(i)
    var bit = 1 << i
    var e = 0
    for (var k = 0; k < this._size; k++) {
      if (k & bit) continue
      e += this._amp[k] * this._amp[k ^ bit]
    }
    e *= 2 // <Xi>
    var pp = (1 + e) / 2
    pp = pp < 0 ? 0 : (pp > 1 ? 1 : pp)
    return { '+': pp, '-': 1 - pp }
  }

  Register.prototype.probabilities = function (i, basis) {
    return basis === 'X' ? this.probabilitiesX(i) : this.probabilitiesZ(i)
  }

  Register.prototype.probability = function (i, basis, result) {
    var p = this.probabilities(i, basis)
    return p[result]
  }

  Register.prototype.isDeterministicIn = function (i, basis) {
    var p = this.probabilities(i, basis)
    var first = basis === 'Z' ? '0' : '+'
    return p[first] > 1 - EPS || p[basis === 'Z' ? '1' : '-'] > 1 - EPS
  }

  /* ------------------------------------------------------------------ *
   * Gates
   * ------------------------------------------------------------------ */

  Register.prototype.hadamard = function (i) {
    this._check(i)
    var bit = 1 << i
    for (var k = 0; k < this._size; k++) {
      if (k & bit) continue
      var a = this._amp[k]
      var b = this._amp[k | bit]
      this._amp[k] = (a + b) * SQRT1_2
      this._amp[k | bit] = (a - b) * SQRT1_2
    }
    this._note('H', 'H GATE', i)
    return this
  }

  Register.prototype.not = function (i) {
    this._check(i)
    var bit = 1 << i
    for (var k = 0; k < this._size; k++) {
      if (k & bit) continue
      var t = this._amp[k]
      this._amp[k] = this._amp[k | bit]
      this._amp[k | bit] = t
    }
    this._note('NOT', 'FLIP GATE', i)
    return this
  }

  Register.prototype.phaseFlip = function (i) {
    this._check(i)
    var bit = 1 << i
    for (var k = 0; k < this._size; k++) {
      if (k & bit) this._amp[k] = -this._amp[k]
    }
    this._note('PHASE', 'PHASE INVERTER', i)
    return this
  }

  /** Controlled-NOT: flips the target whenever the control qubit is 1. */
  Register.prototype.cnot = function (control, target) {
    this._check(control)
    this._check(target)
    if (control === target) throw new Error('quantum/register: CNOT control and target must differ')
    var cb = 1 << control
    var tb = 1 << target
    for (var k = 0; k < this._size; k++) {
      if ((k & cb) && !(k & tb)) {
        var t = this._amp[k]
        this._amp[k] = this._amp[k | tb]
        this._amp[k | tb] = t
      }
    }
    this._note('CNOT', 'CNOT', control, target)
    return this
  }

  Register.prototype._note = function (gate, label, i, j) {
    this._log.push({
      index: this._log.length + 1,
      type: 'gate',
      gate: gate,
      label: label,
      qubit: i,
      target: j,
      ket: this.ketString()
    })
  }

  /* ------------------------------------------------------------------ *
   * Measurement — Born rule, sampled with Math.random, then collapse
   * ------------------------------------------------------------------ */

  function sample (rng, candidates, probs) {
    var roll = rng()
    if (!(roll >= 0)) roll = 0
    if (roll >= 1) roll = 0.9999999999999999
    var acc = 0
    for (var i = 0; i < candidates.length; i++) {
      acc += probs[candidates[i]]
      if (roll < acc) return candidates[i]
    }
    return candidates[candidates.length - 1]
  }

  /** Measure one qubit in Z. @returns {'0'|'1'} */
  Register.prototype.measureZ = function (i) {
    this._check(i)
    var predicted = this.probabilitiesZ(i)
    var result = sample(this._rng, Z_RESULTS, predicted)
    for (var k = 0; k < this._size; k++) {
      if (this._bit(k, i) !== (result === '1' ? 1 : 0)) this._amp[k] = 0
    }
    this._renormalise()
    this._noteMeasure('Z', result, i, predicted[result])
    return result
  }

  /** Measure one qubit in X. @returns {'+'|'-'} */
  Register.prototype.measureX = function (i) {
    this._check(i)
    var predicted = this.probabilitiesX(i)
    var result = sample(this._rng, X_RESULTS, predicted)
    var bit = 1 << i
    var sign = result === '+' ? 1 : -1
    var p = predicted[result]

    // project onto the +/- eigenstate of Xi: |psi'> = (|psi> + sign*Xi|psi>) / sqrt(2p)
    // this must read from a copy: writing _amp[k] in place would corrupt the
    // partner _amp[k ^ bit] that the very next iteration still needs
    var next = new Array(this._size)
    var scale = p > EPS ? 1 / Math.sqrt(2 * p) : 0
    for (var k = 0; k < this._size; k++) {
      next[k] = (this._amp[k] + sign * this._amp[k ^ bit]) * scale
    }
    for (var j = 0; j < this._size; j++) this._amp[j] = next[j]

    this._renormalise()
    this._noteMeasure('X', result, i, predicted[result])
    return result
  }

  Register.prototype.measure = function (i, basis) {
    return basis === 'X' ? this.measureX(i) : this.measureZ(i)
  }

  Register.prototype._noteMeasure = function (basis, result, i, probability) {
    this._log.push({
      index: this._log.length + 1,
      type: 'measure',
      basis: basis,
      result: result,
      qubit: i,
      // the chance of this outcome *before* the collapse, not after it
      probability: probability,
      ket: this.ketString()
    })
  }

  /**
   * Re-run a lab preparation for one group of qubits, leaving the rest at |0>.
   * This is what a re-preparation coil does: it rebuilds the entangled pair
   * from scratch rather than undoing whatever a player did to it.
   *
   * @param {number[]} indices the qubits in the group
   * @param {boolean} [same=true] false builds the anti-correlated singlet
   */
  Register.prototype.reprepareGroup = function (indices, same) {
    if (!indices || indices.length < 2) {
      throw new Error('quantum/register: reprepareGroup needs at least two qubits')
    }
    indices.forEach(this._check.bind(this))

    this._clear()
    var b = SQRT1_2

    var base = 0
    for (var i = 0; i < indices.length; i++) base |= 0 // all bits zero
    var allOnes = 0
    for (var j = 0; j < indices.length; j++) allOnes |= (1 << indices[j])

    this._amp[base] = b
    if (same === false) {
      // anti-correlated: exactly one of the group is 1
      this._amp[base | (1 << indices[0])] = -b
    } else {
      this._amp[allOnes] = b
    }
    return this._prepare()
  }

  /**
   * Prepare several disjoint Bell pairs at once, each (|00>+|11>)/sqrt(2), with
   * every qubit not named in a group left at |0>.
   *
   * Two pairs are a *product* of two pairs, not one pair over four qubits, so
   * all 2^G combinations have to be written out. Preparing them together also
   * matters: re-preparing one group must not erase the others.
   *
   * @param {number[][]} groups arrays of qubit indices
   */
  Register.prototype.repreparePairs = function (groups) {
    if (!groups || !groups.length) throw new Error('quantum/register: repreparePairs needs at least one group')
    var seen = {}
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].length < 2) throw new Error('quantum/register: each group needs at least two qubits')
      for (var i = 0; i < groups[g].length; i++) {
        this._check(groups[g][i])
        if (seen[groups[g][i]]) throw new Error('quantum/register: a qubit cannot be in two pairs')
        seen[groups[g][i]] = true
      }
    }

    this._clear()
    var amp = Math.pow(SQRT1_2, groups.length)
    for (var combo = 0; combo < (1 << groups.length); combo++) {
      var idx = 0
      for (var h = 0; h < groups.length; h++) {
        if (!(combo & (1 << h))) continue
        for (var j = 0; j < groups[h].length; j++) idx |= (1 << groups[h][j])
      }
      this._amp[idx] = amp
    }
    return this._prepare()
  }

  /** The prepared state as a plain array, for saving or comparing. */
  Register.prototype.getStateVector = function () {
    return this._amp.map(function (v) { return Math.round(v * 1e9) / 1e9 })
  }

  /* ------------------------------------------------------------------ *
   * History / reset
   * ------------------------------------------------------------------ */

  Register.prototype.getHistory = function () { return this._log.slice() }

  Register.prototype.getMeasurementHistory = function () {
    return this._log.filter(function (e) { return e.type === 'measure' })
  }

  Register.prototype.getGateHistory = function () {
    return this._log.filter(function (e) { return e.type === 'gate' })
  }

  /** Measurement history for one qubit only. */
  Register.prototype.getMeasurementHistoryFor = function (i, basis) {
    return this.getMeasurementHistory().filter(function (e) {
      return e.qubit === i && (!basis || e.basis === basis)
    })
  }

  Register.prototype.reset = function () {
    this._amp = this._resetTo.slice()
    this._log.length = 0
    return this
  }

  /** Empty the log without touching the state. */
  Register.prototype.clearHistory = function () {
    this._log.length = 0
    return this
  }

  Register.prototype.setAmplitudes = function (arr) {
    if (!arr || arr.length !== this._size) {
      throw new Error('quantum/register: expected ' + this._size + ' amplitudes')
    }
    for (var k = 0; k < this._size; k++) this._amp[k] = Number(arr[k])
    this._renormalise()
    return this
  }

  /* ------------------------------------------------------------------ *
   * Standard preparations
   * ------------------------------------------------------------------ */

  /** |00..0> */
  Register.prototype.setAllZeros = function () {
    this._clear()
    this._amp[0] = 1
    return this._prepare()
  }

  /** The Bell pair (|00> + |11>)/sqrt(2). */
  Register.prototype.setBell = function () {
    return this.setBellPair(true)
  }

  /**
   * Any Bell pair:
   *   same = true  -> (|00> + |11>)/sqrt(2)  = Phi+   Z agrees,  X agrees
   *   same = false -> (|01> - |10>)/sqrt(2)  = Psi-   Z differs, X differs
   * Both are entangled; only the anti-correlated singlet disagrees in both.
   */
  Register.prototype.setBellPair = function (same) {
    if (this._n < 2) throw new Error('quantum/register: a Bell pair needs two qubits')
    this._clear()
    var b = SQRT1_2
    if (same === false) {
      this._amp[1] = b
      this._amp[(1 << this._n) - 2] = -b
    } else {
      this._amp[0] = b
      this._amp[(1 << this._n) - 1] = b
    }
    return this._prepare()
  }

  var PREPARERS = {
    ZEROS: function (r) { r.setAllZeros() },
    ONES: function (r) {
      var arr = []
      for (var k = 0; k < r.size(); k++) arr.push(k === r.size() - 1 ? 1 : 0)
      r.setAmplitudes(arr)
    },
    BELL: function (r) { r.setBellPair(true) },
    PSI_MINUS: function (r) { r.setBellPair(false) }
  }

  Register.PREPARERS = PREPARERS
  Register.LABEL = LABEL

  return { Register: Register, PREPARERS: PREPARERS, LABEL: LABEL }
})
