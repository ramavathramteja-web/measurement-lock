/*
 * tests/registerTests.js — physics checks for the two-qubit register.
 *
 * Run:  node tests/registerTests.js
 *
 * The Bell pair is where a game can quietly lie to the player, so the
 * correlation, collapse and entanglement claims are all pinned down here.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../quantum/register.js'))
  } else {
    root.ML = root.ML || {}
    root.ML.registerTests = factory(root.ML.quantum)
  }
})(typeof self !== 'undefined' ? self : globalThis, function (quantumReg) {
  'use strict'

  var Register = quantumReg.Register

  var results = { pass: 0, fail: 0, failures: [] }
  function log (s) { if (typeof console !== 'undefined' && console.log) console.log(s) }
  function describe (n) { log('\n' + n) }
  function ok (cond, label, detail) {
    if (cond) {
      results.pass++
      log('  PASS  ' + label)
    } else {
      results.fail++
      results.failures.push(label + (detail ? '  (' + detail + ')' : ''))
      log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''))
    }
  }
  function eq (a, b, label) {
    ok(a === b, label, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b))
  }
  function near (a, b, label, tol) {
    ok(Math.abs(a - b) < (tol || 1e-9), label, 'got ' + a + ', want ' + b)
  }

  /* -------------------------------------------------- basics */

  describe('1. Register plumbing')

  var r = new Register(2)
  eq(r.count(), 2, 'a two-qubit register reports two qubits')
  eq(r.size(), 4, 'and holds four amplitudes')
  near(Math.sqrt(r.amp().reduce(function (a, v) { return a + v * v }, 0)), 1,
    'the initial state is normalised')
  eq(r.ketString(), '|00\u27e9', 'the initial state is |00\u27e9')
  ok(!r.isEntangled(), '|00\u27e9 is not entangled')

  var threw = false
  try { new Register(0) } catch (e) { threw = true }
  ok(threw, 'a register with no qubits is rejected')

  threw = false
  try { r.hadamard(7) } catch (e) { threw = true }
  ok(threw, 'an out-of-range qubit index is rejected')

  threw = false
  try { r.cnot(0, 0) } catch (e) { threw = true }
  ok(threw, 'a CNOT onto itself is rejected')

  /* -------------------------------------------------- single qubit limit
   * A one-qubit register must agree with Qubit exactly, or the annex rooms
   * would quietly teach different physics from the first nine labs. */

  describe('2. One qubit inside a register matches qubit.js')

  var q = require('../quantum/qubit.js')
  ;[['0', 'Z', '0'], ['1', 'Z', '1'], ['+', 'X', '+'], ['-', 'X', '-'],
    ['0', 'X', '+'], ['1', 'X', '-'], ['+', 'Z', '0'], ['-', 'Z', '1']
  ].forEach(function (t) {
    var single = new q.Qubit(t[0])
    var inReg = new Register(1)
    inReg.setAmplitudes(q.amplitudesOf(t[0]))
    var pr = inReg.probabilities(0, t[1])
    near(pr[t[2]], single.probability(t[1], t[2]),
      '|q\u27e9 gives the same ' + t[1] + ' probability as Qubit')
  })

  var hg = new Register(1)
  hg.hadamard(0)
  var hq = new q.Qubit('0')
  hq.hadamard()
  eq(hg.ketString(), '|+\u27e9', 'the H gate agrees with Qubit')
  near(hg.probability(0, 'Z', '0'), hq.probability('Z', '0'), 'and so do the probabilities')

  /* -------------------------------------------------- Bell pair */

  describe('3. The Bell pair')

  var bell = new Register(2)
  bell.setBellPair(true)
  eq(bell.ketString(), 'ENTANGLED', 'a Bell pair is reported as entangled')
  ok(bell.isEntangled(), 'and the entanglement test agrees')

  near(bell.probability(0, 'Z', '0'), 0.5, 'qubit 0 in Z is a coin flip')
  near(bell.probability(1, 'Z', '0'), 0.5, 'qubit 1 in Z is a coin flip')
  ok(!bell.isDeterministicIn(0, 'Z') && !bell.isDeterministicIn(1, 'Z'),
    'neither qubit is certain in Z on its own')

  // Phi+ = (|++> + |-->)/sqrt(2), so X is random too - but never in disagreement
  near(bell.probability(0, 'X', '+'), 0.5, 'qubit 0 in X is also a coin flip')
  near(bell.probability(1, 'X', '+'), 0.5, 'qubit 1 in X is also a coin flip')
  ok(!bell.isDeterministicIn(0, 'X') && !bell.isDeterministicIn(1, 'X'),
    'entanglement does not make either basis certain on its own')

  near(bell.correlationZZ(0, 1), 1, 'the two qubits always agree in Z')

  var psi = new Register(2)
  psi.setBellPair(false)
  ok(psi.isEntangled(), 'the singlet is entangled')
  near(psi.correlationZZ(0, 1), -1, 'and its qubits always disagree in Z')
  near(psi.probability(0, 'Z', '0'), 0.5, 'its qubits are still individually random')

  /* -------------------------------------------------- correlation in X */

  describe('4. The pair is correlated in every basis')

  var xCounts = { same: 0, differ: 0, first: {} }
  var XTRIALS = 4000
  for (var xt = 0; xt < XTRIALS; xt++) {
    var xb = new Register(2)
    xb.setBellPair(true)
    var p = xb.measureX(0)
    var s = xb.measureX(1)
    xCounts.first[p] = (xCounts.first[p] || 0) + 1
    if (p === s) xCounts.same++
    else xCounts.differ++
  }
  eq(xCounts.differ, 0, 'in X the two qubits never disagree over ' + XTRIALS + ' trials')
  eq(xCounts.same, XTRIALS, 'they agreed every time in X as well')
  ok(xCounts.first['+'] > XTRIALS * 0.4 && xCounts.first['+'] < XTRIALS * 0.6,
    'while each X readout really was random', JSON.stringify(xCounts.first))

  var yCounts = { same: 0, differ: 0 }
  for (var yt = 0; yt < XTRIALS; yt++) {
    var yp = new Register(2)
    yp.setBellPair(false)
    var a2 = yp.measureX(0)
    var b2 = yp.measureX(1)
    if (a2 === b2) yCounts.same++
    else yCounts.differ++
  }
  eq(yCounts.same, 0, 'the anti-correlated pair never agrees in X')
  eq(yCounts.differ, XTRIALS, 'it disagrees every time')

  /* -------------------------------------------------- collapse & correlation */

  describe('4. Measuring one qubit says what the other will do')

  var counts = { same: 0, differ: 0, results: {} }
  var TRIALS = 4000
  for (var t = 0; t < TRIALS; t++) {
    var b = new Register(2)
    b.setBellPair(true)
    var a = b.measureZ(0)
    var c = b.measureZ(1)
    counts.results[a] = (counts.results[a] || 0) + 1
    if (a === c) counts.same++
    else counts.differ++
  }
  eq(counts.differ, 0, 'qubit 1 never contradicts qubit 0 over ' + TRIALS + ' trials')
  eq(counts.same, TRIALS, 'they agreed every single time')
  ok(counts.results['0'] > TRIALS * 0.4 && counts.results['0'] < TRIALS * 0.6,
    'while each first readout really was random',
    JSON.stringify(counts.results))

  var one = new Register(2)
  one.setBellPair(true)
  var firstQ = one.measureZ(0)
  ok(one.isDeterministicIn(1, 'Z'), 'after measuring qubit 0, qubit 1 is certain in Z')
  eq(one.probability(1, 'Z', firstQ), 1, 'and the certain answer is the same one')
  eq(one.measureZ(1), firstQ, 'so the second readout always matches the first')

  // the pair is no longer entangled once one qubit has been read
  var stillEntangled = new Register(2)
  stillEntangled.setBellPair(true)
  stillEntangled.measureZ(0)
  ok(!stillEntangled.isEntangled(), 'reading one qubit collapses the pair out of entanglement')

  // and the reverse order behaves the same way
  var rev = new Register(2)
  rev.setBellPair(true)
  var bFirst = rev.measureZ(1)
  ok(rev.isDeterministicIn(0, 'Z'), 'reading qubit 1 first makes qubit 0 certain')
  eq(rev.measureZ(0), bFirst, 'and they still agree')

  /* -------------------------------------------------- X basis surprise */

  describe('5. Reading one qubit settles the other, in either basis')

  var xb2 = new Register(2)
  xb2.setBellPair(true)
  near(xb2.probability(0, 'X', '-'), 0.5, 'qubit 0 in X gives + and \u2212 equally')
  var bx = xb2.measureX(0)
  ok(xb2.isDeterministicIn(1, 'X'), 'after reading qubit 0 in X, qubit 1 is certain in X')
  eq(xb2.measureX(1), bx, 'and it repeats the same sign, whichever sign it was')

  /* -------------------------------------------------- gates */

  describe('6. Gates')

  var g = new Register(2)
  g.setAllZeros()
  g.hadamard(0)
  ok(!g.isEntangled(), 'H on one qubit of |00\u27e9 leaves it a product state')
  eq(g.singleQubitState(0), '+', 'qubit 0 is |+\u27e9')
  eq(g.singleQubitState(1), '0', 'qubit 1 is still |0\u27e9')

  g.cnot(0, 1)
  ok(g.isEntangled(), 'the CNOT entangles the pair')
  eq(g.ketString(), 'ENTANGLED', 'and it now reports as entangled')

  var u = new Register(2)
  u.setAllZeros()
  u.hadamard(0)
  u.cnot(0, 1)
  u.hadamard(0)
  u.hadamard(1)
  near(u.correlationZZ(0, 1), 1, 'undoing both H gates leaves the Bell pair')
  ok(u.isEntangled(), 'still entangled')

  var flip = new Register(2)
  flip.setBellPair(true)
  flip.not(0)
  near(flip.correlationZZ(0, 1), -1, 'flipping one qubit flips the correlation')

  var ph = new Register(2)
  ph.setBellPair(true)
  ph.phaseFlip(0)
  near(ph.probability(0, 'X', '+'), 0.5, 'a local phase flip makes the X readout random')
  near(ph.probability(0, 'X', '-'), 0.5, 'both ways equally')
  ok(ph.isEntangled(), 'but the qubits are still perfectly correlated in Z')
  near(ph.correlationZZ(0, 1), 1, 'correlation in Z is untouched by a local phase')

  /* -------------------------------------------------- bloch coords */

  describe('7. Bloch coordinates of a register qubit')

  var bc = new Register(2)
  bc.setBellPair(true)
  var c0 = bc.blochCoords(0)
  near(c0.z, 0, 'an entangled qubit has no Z bias', 1e-9)
  near(c0.x, 0, 'and no X bias either', 1e-9)
  ok(c0.r < 1e-6, 'so its Bloch vector has no length: it is genuinely mixed')

  var pure = new Register(2)
  pure.setAllZeros()
  pure.hadamard(0)
  var p0 = pure.blochCoords(0)
  near(p0.x, 1, 'a separable |+\u27e9 qubit points along +x')
  near(p0.z, 0, 'with no Z component')
  ok(pure.blochCoords(1).r > 0.999, 'a separable |0\u27e9 qubit is a full length')

  /* -------------------------------------------------- history & reset */

  describe('8. History and reset')

  var h = new Register(2)
  h.setBellPair(true)
  h.measureZ(0)
  h.hadamard(1)
  h.measureX(1)
  eq(h.getMeasurementHistory().length, 2, 'both readouts are logged')
  eq(h.getGateHistory().length, 1, 'the gate is logged separately')
  eq(h.getHistory().length, 3, 'the full log interleaves them')
  eq(h.getMeasurementHistoryFor(0).length, 1, 'history can be filtered to one qubit')
  eq(h.getMeasurementHistoryFor(1, 'X').length, 1, 'and to one basis')
  eq(h.getMeasurementHistoryFor(0)[0].qubit, 0, 'entries remember which qubit they came from')

  h.reset()
  eq(h.getHistory().length, 0, 'reset clears the log')
  ok(h.isEntangled(), 'reset restores the entangled state')

  return results
})

if (typeof module === 'object' && module.exports && typeof process !== 'undefined') {
  var results = module.exports
  console.log('\n=============================================')
  console.log(' MEASUREMENT LOCK \u00b7 register tests')
  console.log('=============================================')
  console.log('\n passed: ' + results.pass + '   failed: ' + results.fail)
  if (results.failures.length) {
    console.log('\n failures:')
    results.failures.forEach(function (f) { console.log('  - ' + f) })
  }
  console.log('\n=============================================\n')
  process.exit(results.fail === 0 ? 0 : 1)
}
