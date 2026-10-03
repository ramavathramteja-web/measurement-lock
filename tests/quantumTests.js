/*
 * tests/quantumTests.js — automated checks for the quantum engine.
 *
 * Run:  node tests/quantumTests.js
 *
 * Covers the required rule table, collapse/repeatability, the 50/50 sampling
 * distribution over many trials, gates, history recording and reset.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../quantum/qubit.js'))
  } else {
    root.ML = root.ML || {}
    root.ML.QuantumTests = factory(root.ML.quantum)
  }
})(typeof self !== 'undefined' ? self : globalThis, function (quantum) {
  'use strict'

  var Qubit = quantum.Qubit

  /* -------------------------------------------------- micro test harness */

  var results = { pass: 0, fail: 0, failures: [] }
  var group = ''

  function describe (name) {
    group = name
    log('\n' + name)
  }

  function log (s) {
    if (typeof console !== 'undefined' && console.log) console.log(s)
  }

  function ok (cond, label, detail) {
    if (cond) {
      results.pass++
      log('  PASS  ' + label)
    } else {
      results.fail++
      results.failures.push(group + ' :: ' + label + (detail ? '  (' + detail + ')' : ''))
      log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''))
    }
  }

  function eq (actual, expected, label) {
    ok(actual === expected, label, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
  }

  /* -------------------------------------------------- helpers */

  var TRIALS = 20000

  function sample (state, basis, n) {
    var counts = {}
    var i
    for (i = 0; i < (n || TRIALS); i++) {
      var q = new Qubit(state)
      var r = q.measure(basis)
      counts[r] = (counts[r] || 0) + 1
      if (q.getState() !== r) return { error: 'collapse failed on trial ' + i + ': state is ' + q.getState() + ', result ' + r }
    }
    return { counts: counts }
  }

  function expectDistribution (state, basis, a, b, label) {
    var res = sample(state, basis)
    if (res.error) { ok(false, label, res.error); return }
    var ca = res.counts[a] || 0
    var cb = res.counts[b] || 0
    var total = ca + cb
    var share = ca / total
    var sd = Math.sqrt(0.25 / total)
    var dev = Math.abs(share - 0.5) / sd
    ok(
      dev < 4.5,
      label,
      'n=' + total + '  ' + a + '=' + (share * 100).toFixed(2) + '%  ' +
      b + '=' + ((1 - share) * 100).toFixed(2) + '%  (' + dev.toFixed(2) + ' sigma)'
    )
  }

  function expectCertain (state, basis, result, n, label) {
    var res = sample(state, basis, n || 2000)
    if (res.error) { ok(false, label, res.error); return }
    var keys = Object.keys(res.counts)
    var only = keys.length === 1 && keys[0] === result
    ok(only, label, 'saw ' + JSON.stringify(res.counts))
  }

  /* -------------------------------------------------- 1. rule table */

  describe('1. Measurement rule table')

  eq(new Qubit('0').measureZ(), '0', '|0> measured in Z gives 0')
  eq(new Qubit('1').measureZ(), '1', '|1> measured in Z gives 1')
  eq(new Qubit('+').measureX(), '+', '|+> measured in X gives +')
  eq(new Qubit('-').measureX(), '-', '|-> measured in X gives -')

  ;[['0', 'X'], ['1', 'X'], ['+', 'Z'], ['-', 'Z']].forEach(function (pair) {
    var state = pair[0]
    var basis = pair[1]
    var label = '|' + state + '> + ' + basis
    var allowed = basis === 'Z' ? ['0', '1'] : ['+', '-']
    var q = new Qubit(state)
    var r = q.measure(basis)
    ok(allowed.indexOf(r) !== -1, label + ' gives ' + r + ' (or ' + allowed.join('/') + ')', 'got ' + r)
    eq(q.getState(), r, label + ' collapses the state to the result')
    ok(Math.abs(q.probability(basis, r) - 1) < 1e-9,
      label + ' leaves that outcome certain on a repeat readout')
  })

  /* -------------------------------------------------- 2. determinism over many trials */

  describe('2. Deterministic readouts hold over many trials')

  expectCertain('0', 'Z', '0', 3000, '|0> in Z is 0 every time (3000 trials)')
  expectCertain('1', 'Z', '1', 3000, '|1> in Z is 1 every time (3000 trials)')
  expectCertain('+', 'X', '+', 3000, '|+> in X is + every time (3000 trials)')
  expectCertain('-', 'X', '-', 3000, '|-> in X is - every time (3000 trials)')

  /* -------------------------------------------------- 3. 50/50 sampling */

  describe('3. Probabilistic readouts are ~50/50 over many trials')

  expectDistribution('0', 'X', '+', '-', '|0> in X splits about half and half')
  expectDistribution('1', 'X', '+', '-', '|1> in X splits about half and half')
  expectDistribution('+', 'Z', '0', '1', '|+> in Z splits about half and half')
  expectDistribution('-', 'Z', '0', '1', '|-> in Z splits about half and half')

  /* -------------------------------------------------- 4. collapse */

  describe('4. Measurement collapses the state')

  var collapseCases = [
    ['0', 'X'], ['1', 'X'], ['+', 'Z'], ['-', 'Z'],
    ['0', 'Z'], ['1', 'Z'], ['+', 'X'], ['-', 'X']
  ]

  collapseCases.forEach(function (pair) {
    var state = pair[0]
    var basis = pair[1]
    var other = basis === 'Z' ? 'X' : 'Z'
    var label = '|' + state + '> in ' + basis + ' repeated answers identically'

    // one qubit, three consecutive readouts in the same basis
    var q = new Qubit(state)
    var first = q.measure(basis)
    var second = q.measure(basis)
    var third = q.measure(basis)
    ok(second === first && third === first, label, 'got ' + first + ' then ' + second + ' then ' + third)
    eq(q.getState(), first, label + ' (state matches the outcome)')

    // once collapsed, the same basis is certain while the other basis is not
    var c = new Qubit(state)
    var outcome = c.measure(basis)
    ok(c.isDeterministicIn(basis), label + ' (same basis is now certain)')
    ok(!c.isDeterministicIn(other), label + ' (the other basis is random again)')
    eq(c.probability(basis, outcome), 1, label + ' (P(outcome|same basis) = 100%)')
    var cross = other === 'Z' ? ['0', '1'] : ['+', '-']
    var spread = Math.max(c.probability(other, cross[0]), c.probability(other, cross[1])) -
                 Math.min(c.probability(other, cross[0]), c.probability(other, cross[1]))
    ok(spread < 1e-9,
      label + ' (the other basis is 50/50 again)',
      cross.map(function (r) { return r + '=' + c.probability(other, r).toFixed(3) }).join(' '))
  })

  /* -------------------------------------------------- 5. Born rule predictions */

  describe('5. Predicted probabilities match the Born rule')

  function probs (state, basis) { return new Qubit(state).probabilities(basis) }

  eq(Math.round(probs('0', 'Z')['0'] * 100), 100, 'P(0| |0>, Z) = 100%')
  eq(Math.round(probs('0', 'Z')['1'] * 100), 0, 'P(1| |0>, Z) = 0%')
  eq(Math.round(probs('0', 'X')['+'] * 100), 50, 'P(+| |0>, X) = 50%')
  eq(Math.round(probs('0', 'X')['-'] * 100), 50, 'P(-| |0>, X) = 50%')
  eq(Math.round(probs('1', 'X')['+'] * 100), 50, 'P(+| |1>, X) = 50%')
  eq(Math.round(probs('+', 'Z')['0'] * 100), 50, 'P(0| |+>, Z) = 50%')
  eq(Math.round(probs('+', 'Z')['1'] * 100), 50, 'P(1| |+>, Z) = 50%')
  eq(Math.round(probs('-', 'Z')['0'] * 100), 50, 'P(0| |->, Z) = 50%')
  eq(Math.round(probs('-', 'Z')['1'] * 100), 50, 'P(1| |->, Z) = 50%')
  eq(Math.round(probs('-', 'X')['+'] * 100), 0, 'P(+| |->, X) = 0%')
  eq(Math.round(probs('-', 'X')['-'] * 100), 100, 'P(-| |->, X) = 100%')

  var sumZ = probs('+', 'Z')['0'] + probs('+', 'Z')['1']
  ok(Math.abs(sumZ - 1) < 1e-12, 'Z probabilities sum to 1', String(sumZ))

  ok(new Qubit('0').isDeterministicIn('Z'), '|0> is deterministic in Z')
  ok(!new Qubit('0').isDeterministicIn('X'), '|0> is not deterministic in X')
  ok(new Qubit('-').isDeterministicIn('X'), '|-> is deterministic in X')
  ok(!new Qubit('-').isDeterministicIn('Z'), '|-> is not deterministic in Z')

  /* -------------------------------------------------- 6. gates */

  describe('6. Preparation gates')

  eq(new Qubit('0').hadamard(), '+', 'H maps |0> to |+>')
  eq(new Qubit('1').hadamard(), '-', 'H maps |1> to |->')
  eq(new Qubit('+').hadamard(), '0', 'H maps |+> to |0>')
  eq(new Qubit('-').hadamard(), '1', 'H maps |-> to |1>')

  eq(new Qubit('+').phaseFlip(), '-', 'phase inverter maps |+> to |->')
  eq(new Qubit('-').phaseFlip(), '+', 'phase inverter maps |-> to |+>')
  eq(new Qubit('0').phaseFlip(), '0', 'phase inverter leaves |0> alone')
  eq(new Qubit('1').phaseFlip(), '1', 'phase inverter leaves |1> alone')

  eq(new Qubit('0').not(), '1', 'flip gate maps |0> to |1>')
  eq(new Qubit('1').not(), '0', 'flip gate maps |1> to |0>')
  eq(new Qubit('+').not(), '+', 'flip gate leaves |+> alone (it is an X eigenstate)')
  eq(new Qubit('-').not(), '-', 'flip gate leaves |-> alone (it is an X eigenstate)')

  var prepared = new Qubit('0')
  prepared.hadamard()
  eq(prepared.measureX(), '+', 'after H, the X readout of |0> is certain (+)')
  eq(prepared.measureX(), '+', 'and it stays certain on a repeat readout')

  var phased = new Qubit('1')
  phased.hadamard()
  eq(phased.measureX(), '-', 'after H, the X readout of |1> is certain (-)')
  phased.phaseFlip()
  eq(phased.measureX(), '+', 'after the phase inverter it is certain (+)')

  /* -------------------------------------------------- 7. history */

  describe('7. History, ids and reset')

  var q = new Qubit('0', { id: 'A' })
  q.measureX()
  q.measureX()
  q.phaseFlip()
  q.measureZ()

  var mh = q.getMeasurementHistory()
  eq(mh.length, 3, 'measurement history records every readout')
  eq(mh[0].basis, 'X', 'first readout was in X')
  eq(mh[0].result, mh[1].result, 'the two X readouts match')
  eq(mh[2].basis, 'Z', 'third readout was in Z')
  eq(mh[0].nodeId, 'A', 'history entries carry the node id')
  ok(Math.abs(mh[0].probability - 0.5) < 1e-9, 'the X readout on |0> was logged at 50%', String(mh[0].probability))
  ok(Math.abs(mh[2].probability - 0.5) < 1e-9,
    'after collapsing to |+\u27e9 or |\u2212\u27e9 the Z readout is logged at 50%', String(mh[2].probability))
  eq(q.getState(), mh[2].result, 'the Z readout collapsed the node to |0\u27e9 or |1\u27e9')
  eq(mh[0].stateAfter, mh[0].result, 'the log records the collapsed state')
  eq(q.getGateHistory().length, 1, 'gate history is kept separately')
  eq(q.getHistory().length, 4, 'the full log interleaves gates and readouts')
  eq(q.getHistory()[2].type, 'gate', 'the phase inverter is logged as a gate')

  q.reset()
  eq(q.getState(), '0', 'reset restores the construction state |0>')
  eq(q.getMeasurementHistory().length, 0, 'reset clears the measurement history')
  eq(q.getHistory().length, 0, 'reset clears the whole log')

  /* -------------------------------------------------- 8. api hygiene */

  describe('8. Engine contract')

  eq(typeof Qubit.prototype.getState, 'function', 'getState exists')
  eq(typeof Qubit.prototype.measureZ, 'function', 'measureZ exists')
  eq(typeof Qubit.prototype.measureX, 'function', 'measureX exists')
  eq(typeof Qubit.prototype.reset, 'function', 'reset exists')
  eq(typeof Qubit.prototype.getMeasurementHistory, 'function', 'getMeasurementHistory exists')

  var threw = false
  try { new Qubit('q') } catch (e) { threw = true }
  ok(threw, 'an unknown initial state is rejected')

  threw = false
  try { new Qubit('0').measure('Y') } catch (e) { threw = true }
  ok(threw, 'an unknown basis is rejected')

  threw = false
  try { new Qubit('0').probability('Z', '+') } catch (e) { threw = true }
  ok(threw, 'an invalid result for a basis is rejected')

  // a scripted generator proves the sampler really uses the rng, not a script
  var scripted = new Qubit('0', { rng: function () { return 0.2 } })
  eq(scripted.measureX(), '+', 'a low rng draw picks the first candidate')
  var scripted2 = new Qubit('0', { rng: function () { return 0.99 } })
  eq(scripted2.measureX(), '-', 'a high rng draw picks the second candidate')

  var edgeLo = new Qubit('0', { rng: function () { return 0 } })
  eq(edgeLo.measureX(), '+', 'rng draw of exactly 0 is handled')
  var edgeHi = new Qubit('0', { rng: function () { return 0.9999999999999999 } })
  eq(edgeHi.measureX(), '-', 'rng draw of almost 1 is handled')

  // using the real Math.random, not an injected one
  var real = new Qubit('+')
  var seen = {}
  var i
  for (i = 0; i < 5000; i++) seen[new Qubit('+').measureZ()] = true
  ok(seen['0'] && seen['1'], 'Math.random produces both Z outcomes for |+>')

  return results
})

/* -------------------------------------------------- node runner */

if (typeof module === 'object' && module.exports && typeof process !== 'undefined') {
  var results = module.exports
  console.log('\n=============================================')
  console.log(' MEASUREMENT LOCK \u00b7 quantum engine tests')
  console.log('=============================================')
  console.log('\n passed: ' + results.pass + '   failed: ' + results.fail)
  if (results.failures.length) {
    console.log('\n failures:')
    results.failures.forEach(function (f) { console.log('  - ' + f) })
  }
  console.log('\n=============================================\n')
  process.exit(results.fail === 0 ? 0 : 1)
}
