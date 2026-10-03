/*
 * tests/levelTests.js — level integrity and solvability.
 *
 * Run:  node tests/levelTests.js
 *
 * Three things are proven here:
 *   1. every lab has a hand written solution that completes regardless of how
 *      the random readouts land (each solution is replayed hundreds of times
 *      against real Math.random, so every random branch is exercised);
 *   2. EXHAUSTIVELY, the full reachable state graph of each lab is built and
 *      every single reachable state is shown to still lead to the exit, so no
 *      sequence of player actions can strand the run. Nothing is sampled or
 *      capped: labs 1-8 expand to 3, 38, 42, 1433, 880, 2584, 167250 and
 *      579763 distinct states respectively, all of them checked;
 *   3. a competent player actually finishes every lab in practice;
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../quantum/qubit.js'),
      require('../game/gameState.js'),
      require('../game/levels.js'),
      require('../game/puzzle.js')
    )
  } else {
    root.ML = root.ML.levelTests = factory(root.ML.quantum, root.ML.game, root.ML.game.LEVELS, root.ML.game)
  }
})(typeof self !== 'undefined' ? self : globalThis, function (quantum, gameApi, LEVELS, game) {
  'use strict'

  var Puzzle = game.Puzzle

  /* -------------------------------------------------- harness */

  var results = { pass: 0, fail: 0, failures: [] }
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
  function log (s) { if (typeof console !== 'undefined' && console.log) console.log(s) }
  function describe (n) { log('\n' + n) }
  function eq (a, b, label) {
    ok(a === b, label, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b))
  }

  /* -------------------------------------------------- state fingerprint
   *
   * A puzzle's whole future is determined by:
   *   - per node: whether it is powered, its current state, and for each basis
   *     the last readout result plus whether the one before it matched (that
   *     pair is all an "echo" lock ever looks at);
   *   - which locks are satisfied;
   *   - which switches are powered.
   * Doors are derived from those, so they are left out of the fingerprint.
   */

  var BASIS_STATES = { '0': 1, '1': 1, '+': 1, '-': 1 }

  function key (p) {
    if (p.isRegister) return registerKey(p)

    var parts = []
    p.def.nodes.forEach(function (n) {
      var q = p.qubits[n.id]
      var st = q.getState()
      var tok = n.id + ':' + (p.isNodeLocked(n.id) ? 'L' : st)
      // a gate could in principle build a state outside the four basis states;
      // fall back to the raw amplitudes so the fingerprint stays complete
      if (!BASIS_STATES[st]) tok += '@' + q._a.toFixed(9) + '|' + q._b.toFixed(9)
      parts.push(tok)
      ;['Z', 'X'].forEach(function (b) {
        var h = q.getMeasurementHistoryIn(b)
        if (!h.length) { parts.push(b + '-'); return }
        var last = h[h.length - 1]
        var eq = h.length > 1 && h[h.length - 2].result === last.result
        parts.push(b + last.result + (eq ? '=' : '!'))
      })
      // which basis the most recent readout used: a readout lock looks at
      // lastMeasurement(), so the interleaved order matters, not just the
      // per-basis results
      parts.push(q.lastMeasurement() ? q.lastMeasurement().basis : '-')
    })
    p.def.locks.forEach(function (l) { parts.push(p.locks[l.id].satisfied ? '1' : '0') })
    p.switchList().forEach(function (s) { parts.push(s.powered ? '1' : '0') })
    return parts.join('|')
  }

  /**
   * A register room's whole future is the amplitude vector plus, per qubit, the
   * last readout in each basis and which basis was read most recently.
   */
  function registerKey (p) {
    // Amplitudes are quantised hard: physically reachable values are 0, +-1,
    // +-1/2, +-1/sqrt2 and friends, so snapping near-zero noise keeps the state
    // graph finite instead of exploding on 1e-17 dust.
    var parts = ['R' + p.registerRef.getStateVector().map(function (v) {
      var q = Math.round(v * 1e6) / 1e6
      return Math.abs(q) < 1e-6 ? 0 : q
    }).join(',')]
    p.def.nodes.forEach(function (n, i) {
      var q = p.registerRef
      var last = {}
      var hist = q.getMeasurementHistoryFor(i)
      ;['Z', 'X'].forEach(function (b) {
        var h = q.getMeasurementHistoryFor(i, b)
        if (!h.length) { parts.push(b + '-'); return }
        var l = h[h.length - 1]
        var eq = h.length > 1 && h[h.length - 2].result === l.result
        parts.push(b + l.result + (eq ? '=' : '!'))
      })
      parts.push(hist.length ? hist[hist.length - 1].basis : '-')
      void last
    })
    p.def.locks.forEach(function (l) { parts.push(p.locks[l.id].satisfied ? '1' : '0') })
    p.switchList().forEach(function (s) { parts.push(s.powered ? '1' : '0') })
    return parts.join('|')
  }

  /** Replay a register fingerprint: amplitudes first, then per-qubit history. */
  function restoreRegister (p, k) {
    var parts = k.split('|')
    var amps = parts[0].slice(1).split(',').map(Number)
    p.registerRef.setAmplitudes(amps)
    p.registerRef.clearHistory()

    var i = 1
    p.def.nodes.forEach(function (n, qi) {
      var stubs = { Z: null, X: null }
      ;['Z', 'X'].forEach(function (b) {
        var t = parts[i++]
        if (t === b + '-') return
        var result = t.slice(b.length, b.length + 1)
        var equal = t.slice(b.length + 1) === '='
        var list = [{ type: 'measure', qubit: qi, basis: b, result: result, probability: 0.5, ket: '' }]
        if (equal) {
          list.unshift({ type: 'measure', qubit: qi, basis: b, result: result, probability: 1, ket: '' })
        }
        stubs[b] = list
      })
      var lastBasis = parts[i++]
      var order = lastBasis === 'Z' ? ['X', 'Z'] : ['Z', 'X']
      order.forEach(function (b) {
        if (!stubs[b]) return
        stubs[b].forEach(function (e) { p.registerRef._log.push(e) })
      })
    })

    p.def.locks.forEach(function (l) { p.locks[l.id].satisfied = parts[i++] === '1' })
    p.switchList().forEach(function (s) { s.powered = parts[i++] === '1' })
    p._refreshSwitches()
    p._refreshDoors()
    return true
  }

  /** Rebuild a Puzzle exactly from a fingerprint produced by key(). */
  function restore (p, k) {
    if (p.isRegister) return restoreRegister(p, k)

    var parts = k.split('|')
    var i = 0
    p.def.nodes.forEach(function (n) {
      var tok = parts[i++]
      var st = tok.slice(n.id.length + 1)
      if (st.charAt(0) === '@') {
        p.qubits[n.id]._setAmplitude(st.slice(1).split('|').map(Number))
      } else if (st !== 'L') {
        p.qubits[n.id]._setAmplitude(quantum.amplitudesOf(st))
      }

      // per-basis replay stubs
      var stubs = { Z: null, X: null }
      ;['Z', 'X'].forEach(function (b) {
        var t = parts[i++]
        if (t === b + '-') return
        var result = t.slice(b.length, b.length + 1)
        var equal = t.slice(b.length + 1) === '='
        var list = [{ type: 'measure', nodeId: n.id, basis: b, result: result, probability: 0.5, stateAfter: result }]
        if (equal) {
          list.unshift({ type: 'measure', nodeId: n.id, basis: b, result: result, probability: 1, stateAfter: result })
        }
        stubs[b] = list
      })

      // append them so that the reconstructed most recent readout is the one the
      // fingerprint recorded, keeping lastMeasurement() faithful
      var lastBasis = parts[i++]
      var order = lastBasis === 'Z' ? ['X', 'Z'] : ['Z', 'X']
      if (lastBasis === '-') order = ['Z', 'X']
      order.forEach(function (b) {
        if (!stubs[b]) return
        stubs[b].forEach(function (e) { p.qubits[n.id]._log.push(e) })
      })
    })
    p.def.locks.forEach(function (l) { p.locks[l.id].satisfied = parts[i++] === '1' })
    p.switchList().forEach(function (s) { s.powered = parts[i++] === '1' })
    p._refreshSwitches()
    // branch routes are not re-derivable from the lock alone: they depend on
    // which result fired it, so replay that here too
    p.def.locks.forEach(function (l) {
      if (!l.branch || !p.locks[l.id].satisfied) return
      var h = p.qubits[l.node].getMeasurementHistoryIn(l.basis)
      var last = h[h.length - 1]
      if (!last) return
      var doorId = l.branch[last.result]
      if (doorId && p.doors[doorId]) p.doors[doorId].open = true
    })
    p._refreshDoors()
    return true
  }

  /* -------------------------------------------------- actions */

  function legalActions (p) {
    var acts = []
    p.def.nodes.forEach(function (n) {
      if (p.isNodeLocked(n.id)) return
      acts.push({ kind: 'measure', node: n.id, basis: 'Z' })
      acts.push({ kind: 'measure', node: n.id, basis: 'X' })
    })
    ;(p.def.devices || []).forEach(function (d) {
      if (d.type === 'REPREP') { acts.push({ kind: 'device', id: d.id }); return }
      if (p.isNodeLocked(d.node)) return
      acts.push({ kind: 'device', id: d.id })
    })
    p.switchList().forEach(function (s) {
      if (s.enabled && !s.powered) acts.push({ kind: 'switch', id: s.id })
    })
    // RESET is a real button, so it is a real move. Counting it is the honest
    // way to ask "can this room ever soft-lock the player?".
    acts.push({ kind: 'reset' })
    return acts
  }

  function apply (p, a) {
    if (a.kind === 'measure') p.measure(a.node, a.basis)
    else if (a.kind === 'device') p.applyDevice(a.id)
    else if (a.kind === 'switch') p.flipSwitch(a.id)
    else if (a.kind === 'reset') p.reset()
  }

  /* -------------------------------------------------- exhaustive graph
   *
   * Forward breadth-first expansion of the entire reachable state graph,
   * stored as a compressed sparse row adjacency structure, then a backwards
   * sweep from every state that already has its exit open. Any reachable state
   * the sweep cannot reach is a dead end, and there must be none.
   */

  var MAX_STATES = 1200000

  function explore (level) {
    var start = new Puzzle(level)
    var startKey = key(start)

    var ids = new Map()
    ids.set(startKey, 0)

    var offsets = [0]
    var edges = []
    var completing = []
    var truncated = false

    var queue = [startKey]
    var head = 0
    var id = 0

    while (head < queue.length) {
      var k = queue[head++]
      var probe = new Puzzle(level)
      restore(probe, k)
      if (probe.exitOpen()) {
        completing.push(id)
      } else {
        var acts = legalActions(probe)
        for (var i = 0; i < acts.length; i++) {
          // each successor must start from the same parent state, so every
          // action needs its own copy - reusing one probe would silently
          // explore chains of actions instead of all single moves
          var child = new Puzzle(level)
          restore(child, k)
          apply(child, acts[i])
          var nk = key(child)
          var nid = ids.get(nk)
          if (nid === undefined) {
            if (ids.size >= MAX_STATES) { truncated = true; continue }
            nid = ids.size
            ids.set(nk, nid)
            queue.push(nk)
          }
          edges.push(nid)
        }
      }
      offsets.push(edges.length)
      id++
      if (truncated) break
    }

    var count = ids.size
    var out = new Int32Array(offsets)
    var fwd = new Int32Array(edges)

    // reverse adjacency
    var rOffsets = new Int32Array(count + 1)
    for (var e = 0; e < fwd.length; e++) rOffsets[fwd[e] + 1]++
    for (var s = 1; s <= count; s++) rOffsets[s] += rOffsets[s - 1]
    var back = new Int32Array(fwd.length)
    var fill = rOffsets.slice(0, count + 1)
    for (var v = 0; v < count; v++) {
      for (var t = out[v]; t < out[v + 1]; t++) {
        back[fill[fwd[t]]++] = v
      }
    }

    // backwards sweep from every completing state
    var canWin = new Uint8Array(count)
    var stack = []
    for (var c = 0; c < completing.length; c++) {
      canWin[completing[c]] = 1
      stack.push(completing[c])
    }
    while (stack.length) {
      var w = stack.pop()
      for (var r = rOffsets[w]; r < rOffsets[w + 1]; r++) {
        var u = back[r]
        if (!canWin[u]) { canWin[u] = 1; stack.push(u) }
      }
    }

    var deadEnds = []
    var stranded = []
    var zeroReset = 0
    // Map.forEach yields (value, key) — value is the numeric id we need here
    ids.forEach(function (stateId, stateKey) {
      if (canWin[stateId]) {
        zeroReset++
        return
      }
      deadEnds.push(stateKey)
      if (stranded.length < 3) stranded.push(stateKey)
    })

    return {
      count: count,
      completing: completing.length,
      deadEnds: deadEnds,
      truncated: truncated,
      zeroReset: zeroReset,
      examples: stranded
    }
  }

  /* -------------------------------------------------- canonical solutions */

  var M = function (node, basis) { return { kind: 'measure', node: node, basis: basis } }
  var D = function (id) { return { kind: 'device', id: id } }
  var W = function (id) { return { kind: 'switch', id: id } }
  var readout = function (id, node, basis, accept, requires, label) {
    return { id: id, kind: 'readout', node: node, basis: basis, accept: accept, requires: requires || [], label: label }
  }
  var stateLock = function (id, node, state, requires, label) {
    return { id: id, kind: 'state', node: node, state: state, requires: requires || [], label: label }
  }
  var D2 = function (p, id) { apply(p, D(id)) }
  var M2 = function (p, node, basis) { apply(p, M(node, basis)) }

  var SOLUTIONS = {
    1: [M('A', 'Z')],
    2: [M('A', 'Z'), M('B', 'Z')],
    3: [M('A', 'X'), M('B', 'Z')],
    4: [M('A', 'X'), M('A', 'X'), M('B', 'Z'), M('B', 'Z')],
    5: [M('A', 'X'), M('A', 'Z'), M('A', 'Z'), M('B', 'X'), M('B', 'X')],
    6: [M('A', 'Z'), M('A', 'X'), M('A', 'X'), M('B', 'Z'), M('B', 'Z'), M('B', 'X'), M('B', 'X')],
    7: [M('C', 'Z'), W('BUS'), D('H_B'), M('B', 'X'), D('P_B'), M('B', 'X'), M('A', 'Z'), M('A', 'Z')],
    8: [
      M('A', 'Z'), W('BUS'), D('H_C'), M('C', 'X'), D('H_B'), M('B', 'X'),
      D('P_B'), M('B', 'X'), M('A', 'X'), M('A', 'X'), M('C', 'Z'), M('C', 'Z')
    ],
    // lab 9: H then phase then H is X, so |0> -> |1> with no readout at all
    9: [D('H_A'), D('P_A'), D('H_A'), M('A', 'Z'), D('H_B')],
    // lab 10: read the pair in Z, re-prepare it, then read it in X
    10: [M('A', 'Z'), M('B', 'Z'), D('RP'), M('A', 'X'), M('B', 'X')],
    11: [D('SV_A'), M('A', 'X'), D('SV_B'), M('B', 'Z')]
  }

  /* ================================================================== *
   * 1. Level table integrity
   * ================================================================== */

  describe('1. Level table integrity')

  ok(LEVELS.length >= 8, 'there are at least the 8 required labs', String(LEVELS.length))
  ok(LEVELS.slice(0, 8).every(function (l, i) { return l.id === i + 1 }),
    'labs 1-8 are the original required set and stay in order')

  LEVELS.forEach(function (lvl, i) {
    eq(lvl.id, i + 1, 'lab ' + (i + 1) + ' is numbered correctly')
    ok(!!lvl.name, 'lab ' + lvl.id + ' has a name')
    ok(lvl.doors.some(function (d) { return d.exit }), 'lab ' + lvl.id + ' has an exit door')
    ok(lvl.locks.length > 0, 'lab ' + lvl.id + ' has at least one lock')

    lvl.locks.forEach(function (l) {
      var req = l.requires || []
      ok(req.every(function (r) { return lvl.locks.some(function (x) { return x.id === r }) }),
        'lab ' + lvl.id + ' lock ' + l.id + ' only requires locks that exist')
      req.forEach(function (r) {
        var idx = lvl.locks.map(function (x) { return x.id }).indexOf(r)
        var me = lvl.locks.map(function (x) { return x.id }).indexOf(l.id)
        ok(idx < me, 'lab ' + lvl.id + ' lock ' + l.id + ' requires an earlier step (' + r + ')')
      })
    })

    ;(lvl.doors || []).forEach(function (d) {
      ;(d.locks || []).forEach(function (id) {
        ok(lvl.locks.some(function (x) { return x.id === id }),
          'lab ' + lvl.id + ' door ' + d.id + ' refers to existing lock ' + id)
      })
      ;(d.anyLocks || []).forEach(function (id) {
        // an "any" condition may name a lock or a branch route (another door)
        var known = lvl.locks.some(function (x) { return x.id === id }) ||
                    lvl.doors.some(function (x) { return x.id === id })
        ok(known, 'lab ' + lvl.id + ' door ' + d.id + ' any-condition ' + id + ' exists')
      })
    })

    ;(lvl.devices || []).forEach(function (d) {
      if (d.type === 'REPREP') {
        ok((d.qubits || []).every(function (id) {
          return lvl.nodes.some(function (n) { return n.id === id })
        }), 'lab ' + lvl.id + ' device ' + d.id + ' names existing nodes')
        ok((d.qubits || []).length >= 2, 'lab ' + lvl.id + ' device ' + d.id + ' covers a whole group')
        return
      }
      ok(lvl.nodes.some(function (n) { return n.id === d.node }),
        'lab ' + lvl.id + ' device ' + d.id + ' attaches to an existing node')
    })

    lvl.locks.forEach(function (l) {
      if (l.kind === 'gate') {
        ok((lvl.devices || []).some(function (d) { return d.id === l.device }),
          'lab ' + lvl.id + ' gate lock ' + l.id + ' refers to an existing device')
      }
      if (l.kind === 'readout' || l.kind === 'echo' || l.kind === 'match') {
        ok(lvl.nodes.some(function (n) { return n.id === l.node }),
          'lab ' + lvl.id + ' lock ' + l.id + ' refers to an existing node')
        ok(l.basis === 'Z' || l.basis === 'X', 'lab ' + lvl.id + ' lock ' + l.id + ' uses a valid basis')
        if (l.kind === 'readout') {
          ok((l.accept || []).length > 0, 'lab ' + lvl.id + ' lock ' + l.id + ' accepts at least one result')
        }
        if (l.kind === 'match') {
          ok(lvl.nodes.some(function (n) { return n.id === l.other }),
            'lab ' + lvl.id + ' lock ' + l.id + ' compares against an existing node')
          ok(l.other !== l.node, 'lab ' + lvl.id + ' lock ' + l.id + ' compares two different nodes')
        }
      }
      if (l.kind === 'state') {
        ok(lvl.nodes.some(function (n) { return n.id === l.node }),
          'lab ' + lvl.id + ' lock ' + l.id + ' refers to an existing node')
        ok(['0', '1', '+', '-'].indexOf(l.state) !== -1,
          'lab ' + lvl.id + ' lock ' + l.id + ' names a real ket', String(l.state))
      }
    })

    // every node must be measurable from the start, otherwise the lab starts stuck
    ok(lvl.nodes.some(function (n) { return !n.locked }),
      'lab ' + lvl.id + ' starts with at least one powered node')
  })

  /* ================================================================== *
   * 2. Canonical solutions complete on every random branch
   * ================================================================== */

  describe('2. Canonical solutions complete on every random branch')

  var REPLAYS = 400

  LEVELS.forEach(function (lvl) {
    var steps = SOLUTIONS[lvl.id]
    ok(!!steps, 'lab ' + lvl.id + ' has a canonical solution')

    var wins = 0
    var firstFailure = null

    for (var run = 0; run < REPLAYS; run++) {
      var p = new Puzzle(lvl)
      for (var i = 0; i < steps.length; i++) {
        apply(p, steps[i])
        if (p.complete) break
      }
      if (p.complete) wins++
      else if (!firstFailure) {
        firstFailure = {
          events: p.events.map(function (e) {
            return e.type === 'measure' ? e.nodeId + ':' + e.basis + '>' + e.result : e.nodeId + ':' + e.gateLabel
          }),
          locks: p.lockList().map(function (l) { return l.id + (l.satisfied ? '=OK' : '=no') })
        }
      }
    }

    ok(wins === REPLAYS,
      'lab ' + lvl.id + ' (' + lvl.name + ') completes on all ' + REPLAYS + ' random replays',
      wins + '/' + REPLAYS + (firstFailure ? ' first failing trace: ' + JSON.stringify(firstFailure) : ''))
  })

  // The fingerprint has to be a faithful stand-in for the puzzle, otherwise the
  // exhaustive search below is exploring a fiction. Round-trip every lab.
  describe('2b. The state fingerprint round-trips exactly')

  LEVELS.forEach(function (lvl) {
    var p = new Puzzle(lvl)
    SOLUTIONS[lvl.id].forEach(function (a) { apply(p, a) })

    var k = key(p)
    var back = new Puzzle(lvl)
    restore(back, k)

    eq(back.exitOpen(), p.exitOpen(),
      'lab ' + lvl.id + ': a restored state keeps the same exit status')
    eq(back.lockList().map(function (l) { return l.satisfied }).join(','),
      p.lockList().map(function (l) { return l.satisfied }).join(','),
      'lab ' + lvl.id + ': a restored state keeps the same lock flags')
    eq(key(back), k, 'lab ' + lvl.id + ': fingerprinting the restored state gives the same key')
    if (lvl.register) {
      eq(back.registerRef.getStateVector().join(','), p.registerRef.getStateVector().join(','),
        'lab ' + lvl.id + ': the amplitude vector survives the round trip')
    } else {
      lvl.nodes.forEach(function (n) {
        eq(back.qubits[n.id].getState(), p.qubits[n.id].getState(),
          'lab ' + lvl.id + ': node ' + n.id + ' is in the same state after the round trip')
      })
    }
  })

  /* ================================================================== *
   * 3. EXHAUSTIVE: every reachable state can still reach the exit
   * ================================================================== */

  describe('3. Exhaustive reachability: no reachable state is a dead end')

  LEVELS.forEach(function (lvl) {
    var t0 = Date.now()
    var g = explore(lvl)
    var secs = ((Date.now() - t0) / 1000).toFixed(1)

    log('         lab ' + lvl.id + ': ' + g.count + ' reachable states, ' +
      g.completing + ' with the exit open, ' + g.zeroReset + ' reachable without a reset, ' + secs + 's')

    ok(g.completing > 0,
      'lab ' + lvl.id + ' has completing states (' + g.completing + ')')
    if (g.truncated) {
      // an unfinished graph has states with no recorded exits, which would look
      // like dead ends that are not really there
      log('         SKIPPED lab ' + lvl.id + ': stranded-state check (exploration hit the ' +
        MAX_STATES + ' state cap, so the graph is incomplete)')
    } else {
      ok(g.deadEnds.length === 0,
        'lab ' + lvl.id + ' no reachable state can strand the player (' +
        g.count + ' states checked)',
        g.deadEnds.length + ' stranded state(s), e.g. ' + JSON.stringify(g.examples))
    }
    ok(g.zeroReset > 0,
      'lab ' + lvl.id + ' has a reset-free route to the exit (' + g.zeroReset + ' states)')
  })

  describe('3b. The dead-end detector can actually detect')

  // A node that starts unpowered and is never unlocked by any switch can never
  // be measured, so any lock on it is unreachable and every state is stranded.
  // The exhaustive check must report that, otherwise its verdict on the real
  // labs would be worthless.
  var stranded = {
    id: 999,
    name: 'DELIBERATELY UNSOLVABLE',
    nodes: [
      { id: 'A', label: 'NODE A', state: '0', x: 26, y: 30 },
      { id: 'B', label: 'NODE B', state: '1', x: 26, y: 74, locked: true }
    ],
    devices: [],
    switches: [],
    locks: [readout('S1', 'B', 'Z', ['1'], [], 'B \u00b7 Z \u2192 1')],
    doors: [{ id: 'EXIT', locks: ['S1'], label: 'EXIT', x: 92, y: 52, exit: true }]
  }
  var sg = explore(stranded)
  ok(sg.deadEnds.length > 0,
    'a lock on a node that is never powered is reported as unreachable',
    sg.count + ' reachable states, ' + sg.deadEnds.length + ' stranded')
  ok(sg.deadEnds.length === sg.count,
    'every state of that lab is stranded',
    sg.deadEnds.length + '/' + sg.count)
  ok(sg.completing === 0,
    'that lab has no completing state at all',
    String(sg.completing))

  // Same room, but a bus switch unlocks B: now every state must be escapable.
  var fixed = JSON.parse(JSON.stringify(stranded))
  fixed.name = 'REPAIRED'
  fixed.switches = [{ id: 'BUS', label: 'BUS', requires: [], unlocks: ['B'], x: 60, y: 52 }]
  var fg = explore(fixed)
  ok(fg.deadEnds.length === 0 && fg.completing > 0,
    'powering that node removes every dead end',
    fg.count + ' states, ' + fg.deadEnds.length + ' stranded, ' + fg.completing + ' completing')

  /* ================================================================== *
   * 4. A competent player finishes every lab in practice
   * ================================================================== */

  describe('4. A competent player finishes every lab')

  var RANDOM_RUNS = 60
  var MAX_MOVES = 800

  // what a single press of each gate does to a basis ket
  var GATE_ONE_STEP = {
    H: { '0': '+', '1': '-', '+': '0', '-': '1' },
    P: { '0': '0', '1': '1', '+': '-', '-': '+' }
  }

  LEVELS.forEach(function (lvl) {
    var completed = 0
    var exhausted = 0
    var firstStuck = null
    var longest = 0

    for (var run = 0; run < RANDOM_RUNS; run++) {
      var p = new Puzzle(lvl)
      var moves = 0
      var sinceProgress = 0
      var best = 0

      while (!p.complete && moves < MAX_MOVES) {
        var acts = legalActions(p)
        if (!acts.length) break

        var score = p.lockList().filter(function (l) { return l.satisfied }).length
        if (score > best) { best = score; sinceProgress = 0 } else { sinceProgress++ }

        // a real player hits RESET when the room stops giving anything back
        if (sinceProgress > 30) {
          apply(p, { kind: 'reset' })
          moves++
          sinceProgress = 0
          continue
        }

        // score how promising each action is for the locks that are armed now
        var scored = acts.map(function (a) {
          var gain = 0
          if (a.kind === 'measure') {
            var node = a.node
            var q = p.qubits[node]
            p.lockList().forEach(function (l) {
              if (l.satisfied || !p.isArmed(l.id)) return
              var d = l.def
              if (d.node !== node || d.basis !== a.basis) return
              if (d.kind === 'readout') {
                d.accept.forEach(function (r) { gain += q.probability(a.basis, r) })
              } else if (d.kind === 'echo') {
                // repeating a basis repeats the last outcome with the
                // probability that outcome had
                var last = q.getMeasurementHistoryIn(a.basis).slice(-1)[0]
                if (last) gain += q.probability(a.basis, last.result)
              } else if (d.kind === 'match') {
                var partner = p.qubits[d.other].lastMeasurement()
                if (partner && partner.basis === a.basis) gain += q.probability(a.basis, partner.result)
              }
            })
          } else if (a.kind === 'device') {
            var device = (lvl.devices || []).filter(function (x) { return x.id === a.id })[0]
            if (!device) return gain
            p.lockList().forEach(function (l) {
              if (l.satisfied || !p.isArmed(l.id)) return
              var d = l.def
              if (d.kind === 'gate' && d.device === a.id) gain += 3
              if (d.kind === 'state' && d.node === device.node) {
                // does this one gate move the node onto the ket the lock wants?
                var now = p.qubits[d.node].getState()
                var after = now
                if (device.type === 'H') after = GATE_ONE_STEP.H[now]
                else if (device.type === 'PHASE') after = GATE_ONE_STEP.P[now]
                else if (device.type === 'REINIT') after = d.state
                if (after === d.state) gain += 3
                else if (after !== now) gain += 0.5
              }
              if (d.kind === 'readout' && d.node === device.node) {
                // the wanted outcome is currently impossible: a gate on this
                // node is the only thing that can change that
                var possible = 0
                d.accept.forEach(function (r) {
                  possible += p.qubits[d.node].probability(d.basis, r)
                })
                if (possible < 1e-9 && device.type !== 'REINIT') gain += 2
              }
            })
          } else if (a.kind === 'switch') {
            gain += 1.5
          }
          return gain
        })

        // a competent player always takes the most promising action; the random
        // tie-break still lets each run meet different random readouts
        var top = Math.max.apply(null, scored)
        var candidates = acts.filter(function (_, i) { return scored[i] === top })
        apply(p, candidates[(Math.random() * candidates.length) | 0])
        moves++
      }

      longest = Math.max(longest, moves)
      if (p.complete) completed++
      else {
        exhausted++
        if (!firstStuck) {
          firstStuck = {
            move: moves,
            locks: p.lockList().map(function (l) { return l.id + (l.satisfied ? '=OK' : '=no') })
          }
        }
      }
    }

    ok(exhausted === 0,
      'lab ' + lvl.id + ' greedy play always finishes (' + RANDOM_RUNS + ' runs, longest ' + longest + ' moves)',
      completed + '/' + RANDOM_RUNS + ' completed, ' + exhausted + ' wandered past ' +
      MAX_MOVES + ' moves' + (firstStuck ? ', e.g. ' + JSON.stringify(firstStuck) : ''))
  })

  /* ================================================================== *
   * 5. Reset restores a lab to its starting state
   * ================================================================== */

  describe('5. Reset restores a lab to its starting state')

  LEVELS.forEach(function (lvl) {
    var p = new Puzzle(lvl)
    apply(p, SOLUTIONS[lvl.id][0])
    apply(p, SOLUTIONS[lvl.id][0])
    var dirtyEvents = p.events.length
    p.reset()
    ok(p.events.length === 0, 'lab ' + lvl.id + ' reset clears the event log')
    ok(!p.complete, 'lab ' + lvl.id + ' reset closes the exit again')
    ok(dirtyEvents > 0, 'lab ' + lvl.id + ' reset was tested after real activity')
    lvl.nodes.forEach(function (n) {
      eq(p.qubits[n.id].getState(), n.state, 'lab ' + lvl.id + ' node ' + n.id + ' is back to |' + n.state + '\u27e9')
      eq(p.qubits[n.id].getMeasurementHistory().length, 0, 'lab ' + lvl.id + ' node ' + n.id + ' history is cleared')
    })
    var again = new Puzzle(lvl)
    SOLUTIONS[lvl.id].forEach(function (a) { apply(again, a) })
    ok(again.complete, 'lab ' + lvl.id + ' is still solvable after a reset')
  })

  /* ================================================================== *
   * 6. Rules that teach the physics
   * ================================================================== */

  describe('6. Rules that teach the physics')

  var p1 = new Puzzle(LEVELS[0])
  var r1 = p1.measure('A', 'Z')
  eq(r1.probability, 1, 'lab 1: measuring |0\u27e9 in Z is a certainty')
  eq(r1.result, '0', 'lab 1: the lock reads 0')
  ok(p1.complete, 'lab 1 completes after one Z readout')

  var l3 = new Puzzle(LEVELS[2])
  var probs = l3.qubits['A'].probabilities('X')
  ok(Math.abs(probs['+'] - 0.5) < 1e-9 && Math.abs(probs['-'] - 0.5) < 1e-9,
    'lab 3: X on |0\u27e9 is 50/50', JSON.stringify(probs))
  var branches = { '+': 0, '-': 0 }
  var routeOk = true
  var routeDetail = ''
  for (var i = 0; i < 200; i++) {
    var q = new Puzzle(LEVELS[2])
    var info = q.measure('A', 'X')
    branches[info.result]++
    var expected = info.result === '+' ? 'DPLUS' : 'DMINUS'
    var other = info.result === '+' ? 'DMINUS' : 'DPLUS'
    if (!q.doors[expected].open || q.doors[other].open) {
      routeOk = false
      routeDetail = info.result + ' opened ' + (q.doors[expected].open ? expected : 'nothing')
      break
    }
  }
  ok(routeOk, 'lab 3: the random result opens exactly one matching route', routeDetail)
  ok(branches['+'] > 0 && branches['-'] > 0, 'lab 3 really does produce both results',
    JSON.stringify(branches))

  var l4 = new Puzzle(LEVELS[3])
  var first = l4.measure('A', 'X')
  var second = l4.measure('A', 'X')
  eq(second.result, first.result, 'lab 4: the second X readout repeats the first')
  eq(l4.qubits['A'].probability('X', second.result), 1, 'lab 4: after collapse the X readout is certain')
  eq(l4.qubits['A'].isDeterministicIn('Z'), false, 'lab 4: the Z readout is random again')

  var l5 = new Puzzle(LEVELS[4])
  l5.measure('A', 'X')
  l5.measure('A', 'Z')
  var zRepeat = l5.measure('A', 'Z')
  eq(zRepeat.probability, 1, 'lab 5: repeating the Z basis after collapse is certain')

  var l7 = new Puzzle(LEVELS[6])
  l7.measure('C', 'Z')
  l7.flipSwitch('BUS')
  l7.applyDevice('H_B')
  var certainRead = l7.measure('B', 'X')
  eq(certainRead.result, '+', 'lab 7: after the H gate the X readout of |0\u27e9 is certainly +')
  eq(certainRead.probability, 1, 'lab 7: and it is reported as certain')

  var l8 = new Puzzle(LEVELS[7])
  l8.measure('A', 'Z')
  l8.flipSwitch('BUS')
  l8.applyDevice('H_B')
  var bRead = l8.measure('B', 'X')
  eq(bRead.result, '-', 'lab 8: |1\u27e9 prepared with H reads \u2212 in X, every time')
  l8.applyDevice('P_B')
  var bRead2 = l8.measure('B', 'X')
  eq(bRead2.result, '+', 'lab 8: the phase inverter flips the certain answer to +')

  /* ---- lab 9: interference versus measurement ---- */

  var M9 = new Puzzle(LEVELS[8])
  D2(M9, 'H_A')
  var probs9 = M9.qubits['A'].probabilities('Z')
  ok(Math.abs(probs9['0'] - 0.5) < 1e-9 && Math.abs(probs9['1'] - 0.5) < 1e-9,
    'lab 9: |+\u27e9 read in Z is a coin flip', JSON.stringify(probs9))
  var TRIALS9 = 2000
  var hits = 0
  for (var t9 = 0; t9 < TRIALS9; t9++) {
    var q9 = new Puzzle(LEVELS[8])
    D2(q9, 'H_A')
    if (q9.measure('A', 'Z').result === '1') hits++
  }
  var share9 = hits / TRIALS9
  var sd9 = Math.sqrt(0.25 / TRIALS9)
  ok(Math.abs(share9 - 0.5) / sd9 < 4.5,
    'lab 9: reading the sample on the way lands near 50/50, so it needs retries',
    (share9 * 100).toFixed(2) + '% gave 1 over ' + TRIALS9 + ' trials')

  var clean9 = new Puzzle(LEVELS[8])
  SOLUTIONS[9].forEach(function (a) { apply(clean9, a) })
  eq(clean9.qubits['A'].probability('Z', '1'), 1,
    'lab 9: the gate-only route is certain, so it never needs a retry')
  ok(!new Puzzle(LEVELS[8]).complete, 'lab 9 starts unsolved')

  /* ---- lab 11: gathering evidence costs the sample ---- */

  var sv = new Puzzle(LEVELS[10])
  var before = sv.qubits['A'].getState()
  eq(before, '+', 'lab 11: the sample starts at |+\u27e9')
  var survey = sv.applyDevice('SV_A')
  ok(!!survey, 'lab 11: the spectrometer runs')
  eq(survey.counts['0'] + survey.counts['1'], 12, 'lab 11: it took twelve readouts')
  eq(survey.trials, 12, 'lab 11: and reports the trial count')
  ok(['0', '1'].indexOf(sv.qubits['A'].getState()) !== -1,
    'lab 11: the sample is left collapsed by the survey', sv.qubits['A'].getState())
  ok(sv.qubits['A'].isDeterministicIn('Z'),
    'lab 11: what is left is certain in the surveyed basis')

  // 12 readouts is a small sample, so check the distribution across many surveys
  var ones = 0
  var trials = 0
  for (var s9 = 0; s9 < 120; s9++) {
    var sp = new Puzzle(LEVELS[10])
    var r9 = sp.applyDevice('SV_A')
    ones += r9.counts['1'] || 0
    trials += r9.trials
  }
  var share = ones / trials
  var sd = Math.sqrt(0.25 / trials)
  ok(Math.abs(share - 0.5) / sd < 4.5,
    'lab 11: surveying |+\u27e9 in Z comes out near half and half',
    (share * 100).toFixed(2) + '% ones over ' + trials + ' readouts')

  var svB = new Puzzle(LEVELS[10])
  var rb = svB.applyDevice('SV_B')
  eq(rb.counts['0'], 12, 'lab 11: surveying |0\u27e9 in Z gives twelve zeros')
  ok(!rb.counts['1'], 'lab 11: and never a one', JSON.stringify(rb.counts))

  var sameBasis = new Puzzle(LEVELS[10])
  var ca = sameBasis.applyDevice('SV_A').counts
  var cb = sameBasis.applyDevice('SV_B').counts
  var a0 = ca['0'] || 0
  var a1 = ca['1'] || 0
  ok(Math.abs(a0 - a1) > 0,
    'lab 11: the |+\u27e9 sample came out split across both outcomes', JSON.stringify(ca))
  ok(cb['0'] === 12,
    'lab 11: the |0\u27e9 sample came out all the same', JSON.stringify(cb))

  var good = new Puzzle(LEVELS[8])
  D2(good, 'H_A')
  eq(good.qubits['A'].getState(), '+', 'lab 9: the H gate prepares |+\u27e9 with no readout')
  D2(good, 'P_A')
  eq(good.qubits['A'].getState(), '-', 'lab 9: the phase inverter turns |+\u27e9 into |\u2212\u27e9')
  D2(good, 'H_A')
  eq(good.qubits['A'].getState(), '1', 'lab 9: H after the phase inverter lands on |1\u27e9')
  eq(good.qubits['A'].getMeasurementHistory().length, 0, 'lab 9: not one readout was used')
  eq(good.qubits['A'].probability('Z', '1'), 1, 'lab 9: and that |1\u27e9 is certain')
  ok(good.locks['S1'].satisfied && good.locks['S2'].satisfied, 'lab 9: both state locks fired on the gates alone')

  var ruin = new Puzzle(LEVELS[8])
  D2(ruin, 'H_A')
  M2(ruin, 'A', 'Z') // looking at |+\u27e9 costs you the coherence
  ok(['0', '1'].indexOf(ruin.qubits['A'].getState()) !== -1,
    'lab 9: reading |+\u27e9 collapses it to |0\u27e9 or |1\u27e9', ruin.qubits['A'].getState())
  ok(!ruin.qubits['A'].isDeterministicIn('X'), 'lab 9: the collapsed node is random in X again')
  SOLUTIONS[9].forEach(function (a) { apply(ruin, a) })
  if (!ruin.complete) {
    // The collapse can leave the sample on the wrong footing for the clean
    // route, and a blind replay can even toggle the spare node an even number
    // of times. Re-preparing and replaying more than once always gets there.
    for (var fix = 0; fix < 4 && !ruin.complete; fix++) {
      apply(ruin, D('RV_A'))
      apply(ruin, D('RV_B'))
      SOLUTIONS[9].forEach(function (a) { apply(ruin, a) })
    }
  }
  ok(ruin.complete, 'lab 9 is still completable after the collapse',
    'locks ' + ruin.lockList().map(function (l) { return l.id + (l.satisfied ? '=OK' : '=no') }).join(',') +
    ', A=' + ruin.qubits['A'].getState() + ', B=' + ruin.qubits['B'].getState())

  /* ================================================================== *
   * 7. Wrong basis really does ruin a node (lab 6)
   * ================================================================== */

  describe('7. Wrong basis really does ruin a node (lab 6)')

  var ruined = 0
  for (var i2 = 0; i2 < 120; i2++) {
    var p6 = new Puzzle(LEVELS[5])
    p6.measure('A', 'X') // the wrong first move
    var z1 = p6.measure('A', 'Z')
    if (z1.result !== '0') {
      ruined++
      // the node is now stuck in |1> for Z, exactly as the lesson claims
      eq(p6.qubits['A'].probability('Z', '0'), 0, 'lab 6: a node collapsed to |1\u27e9 can never read 0 again')
      // ...and the re-init coil is the way out
      p6.applyDevice('RV_A')
      eq(p6.qubits['A'].getState(), '0', 'lab 6: the re-init coil restores |0\u27e9')
      SOLUTIONS[LEVELS[5].id].forEach(function (a) { apply(p6, a) })
      ok(p6.complete, 'lab 6 is still completable after the wrong move and a re-init')
    }
  }
  ok(ruined > 0, 'lab 6: measuring in the wrong basis really does strand the node',
    ruined + '/120 runs stranded (the rest were lucky)')

  return results
})

if (typeof module === 'object' && module.exports && typeof process !== 'undefined') {
  var results = module.exports
  console.log('\n=============================================')
  console.log(' MEASUREMENT LOCK \u00b7 lab solvability tests')
  console.log('=============================================')
  console.log('\n passed: ' + results.pass + '   failed: ' + results.fail)
  if (results.failures.length) {
    console.log('\n failures:')
    results.failures.forEach(function (f) { console.log('  - ' + f) })
  }
  console.log('\n=============================================\n')
  process.exit(results.fail === 0 ? 0 : 1)
}