/*
 * quantum/qubit.js — Measurement Lock quantum engine.
 *
 * Pure physics. No DOM, no UI, no game rules.
 *
 * A qubit is stored as a real amplitude pair [a, b] meaning
 *     |psi> = a|0> + b|1>
 * so that
 *     |0> = [1, 0]        |1> = [0, 1]
 *     |+> = [1/sqrt2, +1/sqrt2]
 *     |-> = [1/sqrt2, -1/sqrt2]
 *
 * Measurement probabilities are computed from those amplitudes with the
 * Born rule rather than looked up in a table, which keeps the engine correct
 * for superpositions produced by the phase / Hadamard gates as well.
 *
 * UMD wrapper: works as a plain <script> global (window.ML.quantum) and as a
 * CommonJS module under Node, so the same file powers the game and the tests.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    root.ML.quantum = factory()
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  var SQRT1_2 = Math.SQRT1_2
  var EPS = 1e-9

  var Z_RESULTS = ['0', '1']
  var X_RESULTS = ['+', '-']

  var STATES = ['0', '1', '+', '-']

  var KET = {
    '0': '|0\u27e9',
    '1': '|1\u27e9',
    '+': '|+\u27e9',
    '-': '|\u2212\u27e9',
    '\u03c8': '|\u03c8\u27e9'
  }

  var RAW_KET = { '0': '|0>', '1': '|1>', '+': '|+>', '-': '|->', '\u03c8': '|psi>' }

  var BASIS_RESULTS = { Z: Z_RESULTS, X: X_RESULTS }

  function amplitudesOf (state) {
    switch (state) {
      case '0': return [1, 0]
      case '1': return [0, 1]
      case '+': return [SQRT1_2, SQRT1_2]
      case '-': return [SQRT1_2, -SQRT1_2]
      default:
        throw new Error('quantum/qubit: unknown initial state "' + state + '" (expected one of ' + STATES.join(', ') + ')')
    }
  }

  function isBasis (state) {
    return STATES.indexOf(state) !== -1
  }

  function ketOf (state) {
    return KET[state] || state
  }

  function clamp01 (n) {
    if (!(n > 0)) return 0
    if (n > 1) return 1
    return n
  }

  /**
   * @param {string} [initialState='0'] one of '0' | '1' | '+' | '-'
   * @param {object} [options]
   * @param {function} [options.rng=Math.random] injectable uniform RNG in [0,1)
   * @param {string} [options.id] label used in history entries
   */
  function Qubit (initialState, options) {
    if (!(this instanceof Qubit)) return new Qubit(initialState, options)

    options = options || {}
    if (initialState === undefined || initialState === null) initialState = '0'

    this._rng = typeof options.rng === 'function' ? options.rng : Math.random
    this._id = options.id || null
    this._initial = initialState
    this._log = []
    this._setAmplitude(amplitudesOf(initialState))
  }

  Qubit.STATES = STATES
  Qubit.KET = KET

  Qubit.amplitudesOf = amplitudesOf
  Qubit.isBasisState = isBasis

  Qubit.prototype._setAmplitude = function (pair) {
    this._a = pair[0]
    this._b = pair[1]
  }

  Qubit.prototype._amplitudes = function () {
    return [this._a, this._b]
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  /** @returns {string} '0' | '1' | '+' | '-' (or the greek psi for a generic state) */
  Qubit.prototype.getState = function () {
    var a = this._a
    var b = this._b
    if (Math.abs(a) < EPS && Math.abs(b) < EPS) return '0'
    if (Math.abs(b) < EPS) return '0'
    if (Math.abs(a) < EPS) return '1'
    if (Math.abs(a - b) < EPS) return '+'
    if (Math.abs(a + b) < EPS) return '-'
    return '\u03c8'
  }

  /** Human readable ket, e.g. '|+>' */
  Qubit.prototype.getKet = function () {
    return ketOf(this.getState())
  }

  /** ASCII ket used in the history log, e.g. '|+>' */
  Qubit.prototype.getAsciiKet = function () {
    return RAW_KET[this.getState()] || '|psi>'
  }

  Qubit.prototype.getId = function () {
    return this._id
  }

  Qubit.prototype.setId = function (id) {
    this._id = id
    return this
  }

  Qubit.prototype.getInitialState = function () {
    return this._initial
  }

  Qubit.prototype.isBasisState = function () {
    return isBasis(this.getState())
  }

  /** True when this basis yields a single certain outcome for the current state. */
  Qubit.prototype.isDeterministicIn = function (basis) {
    var p = this.probabilities(basis)
    return p[basis === 'Z' ? '0' : '+'] > 1 - EPS || p[basis === 'Z' ? '1' : '-'] > 1 - EPS
  }

  /* ------------------------------------------------------------------ *
   * Probabilities (Born rule, never hard coded)
   * ------------------------------------------------------------------ */

  /**
   * @param {'Z'|'X'} basis
   * @returns {{'0'?:number,'1'?:number,'+'?:number,'-'?:number}}
   */
  Qubit.prototype.probabilities = function (basis) {
    var a = this._a
    var b = this._b
    if (basis === 'Z') {
      return { '0': clamp01(a * a), '1': clamp01(b * b) }
    }
    if (basis === 'X') {
      // <+|psi> = (a + b)/sqrt2 , <-|psi> = (a - b)/sqrt2
      var plus = (a + b) * SQRT1_2
      var minus = (a - b) * SQRT1_2
      return { '+': clamp01(plus * plus), '-': clamp01(minus * minus) }
    }
    throw new Error('quantum/qubit: unknown basis "' + basis + '" (expected Z or X)')
  }

  /** @param {'Z'|'X'} basis @param {string} result @returns {number} in [0,1] */
  Qubit.prototype.probability = function (basis, result) {
    var p = this.probabilities(basis)
    if (p[result] === undefined) {
      throw new Error('quantum/qubit: result "' + result + '" is not valid for basis ' + basis)
    }
    return p[result]
  }

  /* ------------------------------------------------------------------ *
   * Measurement
   * ------------------------------------------------------------------ */

  /**
   * Measure in a basis: sample the Born distribution with Math.random (or the
   * injected rng), then collapse. Returns the raw result string.
   * @param {'Z'|'X'} basis
   * @returns {string} '0' | '1' | '+' | '-'
   */
  Qubit.prototype.measure = function (basis) {
    var candidates = BASIS_RESULTS[basis]
    if (!candidates) {
      throw new Error('quantum/qubit: unknown basis "' + basis + '" (expected Z or X)')
    }

    var before = this.getState()
    var probs = this.probabilities(basis)

    var roll = this._rng()
    if (!(roll >= 0)) roll = 0
    if (roll >= 1) roll = Math.nextBelow ? Math.nextBelow(1) : 0.9999999999999999

    var acc = 0
    var result = candidates[candidates.length - 1]
    for (var i = 0; i < candidates.length; i++) {
      acc += probs[candidates[i]]
      if (roll < acc) {
        result = candidates[i]
        break
      }
    }

    this._setAmplitude(amplitudesOf(result))

    this._log.push({
      index: this._log.length + 1,
      type: 'measure',
      nodeId: this._id,
      basis: basis,
      result: result,
      probability: probs[result],
      stateBefore: before,
      stateAfter: result
    })

    return result
  }

  /** Measure in the computational basis. @returns {'0'|'1'} */
  Qubit.prototype.measureZ = function () {
    return this.measure('Z')
  }

  /** Measure in the X basis. @returns {'+'|'-'} */
  Qubit.prototype.measureX = function () {
    return this.measure('X')
  }

  /* ------------------------------------------------------------------ *
   * Unitary gates (state preparation / control devices)
   * ------------------------------------------------------------------ */

  function gate (q, name, label, fn) {
    var before = q.getState()
    fn()
    var after = q.getState()
    q._log.push({
      index: q._log.length + 1,
      type: 'gate',
      nodeId: q._id,
      gate: name,
      label: label,
      stateBefore: before,
      stateAfter: after
    })
    return after
  }

  /**
   * Hadamard: |0><->|+>, |1><->|->. Rotates between the Z and X bases.
   * H = 1/sqrt2 * [[1, 1], [1, -1]]
   */
  Qubit.prototype.hadamard = function () {
    return gate(this, 'H', 'H GATE', function () {
      var a = this._a
      var b = this._b
      this._setAmplitude([(a + b) * SQRT1_2, (a - b) * SQRT1_2])
    }.bind(this))
  }

  /**
   * Phase flip (Pauli Z): |+><->|->, |0> and |1> unchanged.
   * The sign of a superposition is real physics: it is what decides the X readout.
   */
  Qubit.prototype.phaseFlip = function () {
    return gate(this, 'PHASE', 'PHASE INVERTER', function () {
      this._setAmplitude([this._a, -this._b])
    }.bind(this))
  }

  /**
   * Bit flip (Pauli X): |0><->|1>. |+> and |-> are its eigenstates and are
   * left alone, which is the whole point of having two bases.
   */
  Qubit.prototype.not = function () {
    return gate(this, 'NOT', 'FLIP GATE', function () {
      this._setAmplitude([this._b, this._a])
    }.bind(this))
  }

  /* ------------------------------------------------------------------ *
   * History / reset
   * ------------------------------------------------------------------ */

  /** Every event, measurements and gates, in order. */
  Qubit.prototype.getHistory = function () {
    return this._log.slice()
  }

  /** Only the measurement events. */
  Qubit.prototype.getMeasurementHistory = function () {
    return this._log.filter(function (e) { return e.type === 'measure' })
  }

  /** Only the gate events. */
  Qubit.prototype.getGateHistory = function () {
    return this._log.filter(function (e) { return e.type === 'gate' })
  }

  /** Measurement history restricted to one basis. */
  Qubit.prototype.getMeasurementHistoryIn = function (basis) {
    return this.getMeasurementHistory().filter(function (e) { return e.basis === basis })
  }

  /** The most recent measurement, or null. */
  Qubit.prototype.lastMeasurement = function () {
    var m = this.getMeasurementHistory()
    return m.length ? m[m.length - 1] : null
  }

  /** Restore the construction state and clear all history. */
  Qubit.prototype.reset = function () {
    this._setAmplitude(amplitudesOf(this._initial))
    this._log.length = 0
    return this
  }

  /** Clear history without touching the state. */
  Qubit.prototype.clearHistory = function () {
    this._log.length = 0
    return this
  }

  /** Force a state without going through measurement (lab "state injector"). */
  Qubit.prototype.setState = function (state) {
    var before = this.getState()
    this._setAmplitude(amplitudesOf(state))
    this._log.push({
      index: this._log.length + 1,
      type: 'gate',
      nodeId: this._id,
      gate: 'INJECT',
      label: 'STATE INJECTOR',
      stateBefore: before,
      stateAfter: state
    })
    return this
  }

  Qubit.prototype.toString = function () {
    return 'Qubit(' + this.getAsciiKet() + ')'
  }

  return {
    Qubit: Qubit,
    STATES: STATES.slice(),
    KET: KET,
    RAW_KET: RAW_KET,
    amplitudesOf: amplitudesOf,
    isBasisState: isBasis
  }
})
