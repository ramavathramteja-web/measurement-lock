/*
 * game/levels.js — declarative level table.
 *
 * Coordinates are percentages of the stage box (x across, y down).
 *
 * Puzzle vocabulary
 *   node     { id, label, state, x, y, locked? }        a qubit in the room
 *   device   { id, node, type: 'H'|'PHASE'|'NOT'|'REINIT', label, x, y }
 *   switch   { id, label, requires: [lockIds], unlocks: [nodeIds], x, y }
 *   lock     { id, kind, node, basis, accept, count, device, requires, branch, label }
 *              kind 'readout' : node measured in `basis` produced a result in `accept`
 *              kind 'echo'    : the last `count` measurements of `node` in `basis`
 *                               are all identical (collapse / repeatability)
 *              kind 'gate'    : the named device was used
 *              `requires` lists locks that must already be satisfied. A lock that
 *              is not armed yet ignores measurements entirely, which is what
 *              forces ordering without ever making a level unsolvable.
 *              `branch` maps a result to a door id, so a random outcome still
 *              opens a route forward.
 *   door     { id, locks: [ids], anyLocks: [ids], label, x, y, exit? }
 *
 * Every level is solvable no matter how the random measurements land: locks
 * that need a certain answer are only reachable after a gate prepares the
 * state, and random answers are always accepted through a branch.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var g = root.ML.game = root.ML.game || {}
    g.LEVELS = factory()
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  function readout (id, node, basis, accept, requires, label) {
    return {
      id: id,
      kind: 'readout',
      node: node,
      basis: basis,
      accept: accept,
      requires: requires || [],
      label: label || (node + ' \u00b7 ' + basis + ' \u2192 ' + accept.join(' or '))
    }
  }

  function echo (id, node, basis, count, requires, label) {
    return {
      id: id,
      kind: 'echo',
      node: node,
      basis: basis,
      count: count || 2,
      requires: requires || [],
      label: label || (node + ' \u00b7 ' + basis + ' ' + (count || 2) + '\u00d7 \u2192 same result')
    }
  }

  function gateLock (id, device, node, requires, label) {
    return {
      id: id,
      kind: 'gate',
      device: device,
      node: node,
      requires: requires || [],
      label: label
    }
  }

  /*
   * A "state" lock is satisfied while the node simply *is* a given ket, rather
   * than by any particular readout. It is what lets a lab demand a prepared
   * superposition: reaching it without measuring keeps it deterministic, while
   * measuring the node on the way there collapses it into a coin flip.
   */
  function stateLock (id, node, state, requires, label) {
    return {
      id: id,
      kind: 'state',
      node: node,
      state: state,
      requires: requires || [],
      label: label || (node + ' must be |' + state + '\u27e9')
    }
  }

  /*
   * A "match" lock fires when one node's readout in a basis repeats another
   * node's readout in the same basis. On an entangled pair the second node
   * cannot disagree, which is how a player discovers the correlation.
   */
  function matchLock (id, node, other, basis, requires, label) {
    return {
      id: id,
      kind: 'match',
      node: node,
      other: other,
      basis: basis,
      requires: requires || [],
      label: label
    }
  }

  var LEVELS = [
    /* -------------------------------------------------------------- 1 */
    {
      id: 1,
      name: 'FIRST LOCK',
      zone: 'CALIBRATION BAY',
      intro: 'One node. One seal. Read it in Z.',
      nodes: [{ id: 'A', label: 'NODE A', state: '0', x: 26, y: 52 }],
      devices: [],
      switches: [],
      locks: [
        readout('S1', 'A', 'Z', ['0'], [], 'A \u00b7 Z \u2192 0')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'SEAL', x: 70, y: 52 },
        { id: 'EXIT', locks: ['S1'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 2 */
    {
      id: 2,
      name: 'TWO STATES',
      zone: 'DUAL CHANNEL',
      intro: 'Two channels, two certain answers.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 20, y: 30 },
        { id: 'B', label: 'NODE B', state: '1', x: 20, y: 74 }
      ],
      devices: [],
      switches: [],
      locks: [
        readout('S1', 'A', 'Z', ['0'], [], 'A \u00b7 Z \u2192 0'),
        readout('S2', 'B', 'Z', ['1'], [], 'B \u00b7 Z \u2192 1')
      ],
      doors: [
        { id: 'DA', locks: ['S1'], label: 'GATE A', x: 70, y: 30 },
        { id: 'DB', locks: ['S2'], label: 'GATE B', x: 70, y: 74 },
        { id: 'EXIT', locks: ['S1', 'S2'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 3 */
    {
      id: 3,
      name: 'THE SURPRISE',
      zone: 'UNSTABLE CORRIDOR',
      intro: 'The corridor splits on the result. Either half will let you out.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 20, y: 30 },
        { id: 'B', label: 'NODE B', state: '1', x: 20, y: 74 }
      ],
      devices: [],
      switches: [],
      locks: [
        {
          id: 'S1',
          kind: 'readout',
          node: 'A',
          basis: 'X',
          accept: ['+', '-'],
          requires: [],
          branch: { '+': 'DPLUS', '-': 'DMINUS' },
          label: 'A \u00b7 X \u2192 + or \u2212 (opens one route)'
        },
        readout('S2', 'B', 'Z', ['0', '1'], [], 'B \u00b7 Z \u2014 any outcome releases the exit')
      ],
      doors: [
        { id: 'DPLUS', locks: [], branchOnly: true, label: 'ROUTE +', x: 58, y: 18 },
        { id: 'DMINUS', locks: [], branchOnly: true, label: 'ROUTE \u2212', x: 58, y: 86 },
        { id: 'EXIT', locks: ['S2'], anyLocks: ['DPLUS', 'DMINUS'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 4 */
    {
      id: 4,
      name: 'COLLAPSE',
      zone: 'REPEATABILITY TEST',
      intro: 'Read it once, then read it again.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 20, y: 30 },
        { id: 'B', label: 'NODE B', state: '1', x: 20, y: 74 }
      ],
      devices: [],
      switches: [],
      locks: [
        readout('S1', 'A', 'X', ['+', '-'], [], 'A \u00b7 X readout (first)'),
        echo('S2', 'A', 'X', 2, [], 'A \u00b7 X twice \u2192 same result'),
        echo('S3', 'B', 'Z', 2, [], 'B \u00b7 Z twice \u2192 same result')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'FIRST READOUT', x: 56, y: 30 },
        { id: 'D2', locks: ['S3'], label: 'B REPEAT', x: 56, y: 74 },
        { id: 'EXIT', locks: ['S2', 'S3'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 5 */
    {
      id: 5,
      name: 'BASIS SWITCH',
      zone: 'BASIS INTERCHANGE',
      intro: 'Switching the basis throws the old certainty away.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 20, y: 30 },
        { id: 'B', label: 'NODE B', state: '1', x: 20, y: 74 }
      ],
      devices: [],
      switches: [],
      locks: [
        readout('S1', 'A', 'X', ['+', '-'], [], '1 \u00b7 A in X \u2014 first readout'),
        readout('S2', 'A', 'Z', ['0', '1'], ['S1'], '2 \u00b7 A in Z \u2014 basis switched'),
        echo('S3', 'A', 'Z', 2, ['S2'], '3 \u00b7 A in Z twice \u2192 same result'),
        echo('S4', 'B', 'X', 2, ['S1'], '4 \u00b7 B in X twice \u2192 same result')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'X PASS', x: 56, y: 22 },
        { id: 'D2', locks: ['S2', 'S3'], label: 'Z PASS', x: 56, y: 74 },
        { id: 'EXIT', locks: ['S1', 'S2', 'S3', 'S4'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 6 */
    {
      id: 6,
      name: 'WRONG BASIS',
      zone: 'ORDER SENSITIVE',
      intro: 'Order matters. Something rewinds a node if you ruin it.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 20, y: 30 },
        { id: 'B', label: 'NODE B', state: '1', x: 20, y: 74 }
      ],
      devices: [
        { id: 'RV_A', node: 'A', type: 'REINIT', label: 'RE-INIT COIL A', x: 38, y: 16 },
        { id: 'RV_B', node: 'B', type: 'REINIT', label: 'RE-INIT COIL B', x: 38, y: 60 }
      ],
      switches: [],
      locks: [
        readout('S1', 'A', 'Z', ['0'], [], '1 \u00b7 A must read 0 in Z'),
        readout('S2', 'A', 'X', ['+', '-'], ['S1'], '2 \u00b7 A must be read in X'),
        echo('S3', 'A', 'X', 2, ['S2'], '3 \u00b7 A in X twice \u2192 same result'),
        echo('S4', 'B', 'Z', 2, [], '4 \u00b7 B in Z twice \u2192 same result'),
        echo('S5', 'B', 'X', 2, ['S4'], '5 \u00b7 B in X twice \u2192 same result')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'Z LOCK', x: 58, y: 22 },
        { id: 'D2', locks: ['S2', 'S3'], label: 'X LOCK', x: 58, y: 50 },
        { id: 'EXIT', locks: ['S3', 'S4', 'S5'], label: 'EXIT', x: 92, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 7 */
    {
      id: 7,
      name: 'SEQUENCE PUZZLE',
      zone: 'SEQUENCING BAY',
      intro: 'Plan the order. Prepare a state, then it stops being random.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 24, y: 20 },
        { id: 'B', label: 'NODE B', state: '0', x: 24, y: 50, locked: true },
        { id: 'C', label: 'NODE C', state: '1', x: 24, y: 80 }
      ],
      devices: [
        { id: 'H_A', node: 'A', type: 'H', label: 'H GATE \u00b7 A', x: 41, y: 8 },
        { id: 'H_B', node: 'B', type: 'H', label: 'H GATE \u00b7 B', x: 41, y: 40 },
        { id: 'P_B', node: 'B', type: 'PHASE', label: 'PHASE INVERTER \u00b7 B', x: 41, y: 60 },
        { id: 'RV_A', node: 'A', type: 'REINIT', label: 'RE-INIT \u00b7 A', x: 10, y: 20 },
        { id: 'RV_B', node: 'B', type: 'REINIT', label: 'RE-INIT \u00b7 B', x: 10, y: 50 },
        { id: 'RV_C', node: 'C', type: 'REINIT', label: 'RE-INIT \u00b7 C', x: 10, y: 80 }
      ],
      switches: [
        { id: 'BUS', label: 'POWER BUS', requires: ['S1'], unlocks: ['A', 'B'], x: 58, y: 50 }
      ],
      locks: [
        readout('S1', 'C', 'Z', ['1'], [], '1 \u00b7 C must read 1 in Z'),
        gateLock('S2', 'H_B', 'B', ['S1'], '2 \u00b7 prepare B with the H gate'),
        readout('S3', 'B', 'X', ['+'], ['S2'], '3 \u00b7 B in X \u2192 + (now certain)'),
        gateLock('S4', 'P_B', 'B', ['S3'], '4 \u00b7 invert the phase of B'),
        readout('S5', 'B', 'X', ['-'], ['S4'], '5 \u00b7 B in X \u2192 \u2212 (phase flipped)'),
        echo('S6', 'A', 'Z', 2, ['S5'], '6 \u00b7 A in Z twice \u2192 same result')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'BUS POWER', x: 74, y: 80 },
        { id: 'D2', locks: ['S3'], label: 'CERTAIN READ', x: 74, y: 26 },
        { id: 'D3', locks: ['S5'], label: 'PHASE LOCK', x: 74, y: 58 },
        { id: 'EXIT', locks: ['S6'], anyLocks: ['D2', 'D3'], label: 'EXIT', x: 93, y: 52, exit: true }
      ]
    },

    /* -------------------------------------------------------------- 8 */
    {
      id: 8,
      finale: true,
      name: 'FINAL MEASUREMENT LOCK',
      zone: 'MEASUREMENT VAULT',
      intro: 'Everything the lab knows, in one room.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 24, y: 20 },
        { id: 'B', label: 'NODE B', state: '1', x: 24, y: 50, locked: true },
        { id: 'C', label: 'NODE C', state: '0', x: 24, y: 80, locked: true }
      ],
      devices: [
        { id: 'H_A', node: 'A', type: 'H', label: 'H GATE \u00b7 A', x: 40, y: 10 },
        { id: 'H_B', node: 'B', type: 'H', label: 'H GATE \u00b7 B', x: 40, y: 38 },
        { id: 'P_B', node: 'B', type: 'PHASE', label: 'PHASE INVERTER \u00b7 B', x: 40, y: 62 },
        { id: 'H_C', node: 'C', type: 'H', label: 'H GATE \u00b7 C', x: 40, y: 92 },
        { id: 'RV_A', node: 'A', type: 'REINIT', label: 'RE-INIT \u00b7 A', x: 10, y: 20 },
        { id: 'RV_B', node: 'B', type: 'REINIT', label: 'RE-INIT \u00b7 B', x: 10, y: 50 },
        { id: 'RV_C', node: 'C', type: 'REINIT', label: 'RE-INIT \u00b7 C', x: 10, y: 80 }
      ],
      switches: [
        { id: 'BUS', label: 'VAULT BUS', requires: ['S1'], unlocks: ['B', 'C'], x: 57, y: 50 }
      ],
      locks: [
        readout('S1', 'A', 'Z', ['0'], [], '1 \u00b7 A in Z \u2192 0'),
        gateLock('S2', 'H_C', 'C', ['S1'], '2 \u00b7 prepare C with the H gate'),
        readout('S3', 'C', 'X', ['+'], ['S2'], '3 \u00b7 C in X \u2192 + (certain after H)'),
        gateLock('S4', 'H_B', 'B', ['S2'], '4 \u00b7 prepare B with the H gate'),
        readout('S5', 'B', 'X', ['-'], ['S4'], '5 \u00b7 B in X \u2192 \u2212 (|1\u27e9 became |\u2212\u27e9)'),
        gateLock('S6', 'P_B', 'B', ['S5'], '6 \u00b7 invert the phase of B'),
        readout('S7', 'B', 'X', ['+'], ['S6'], '7 \u00b7 B in X \u2192 + (phase flipped)'),
        echo('S8', 'A', 'X', 2, ['S4'], '8 \u00b7 A in X twice \u2192 same result'),
        echo('S9', 'C', 'Z', 2, ['S3'], '9 \u00b7 C in Z twice \u2192 same result')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'Z SEAL', x: 74, y: 16 },
        { id: 'D2', locks: ['S3'], label: 'PREPARED READ', x: 74, y: 82 },
        { id: 'D3', locks: ['S5'], label: 'X LOCK', x: 74, y: 37 },
        { id: 'D4', locks: ['S7'], label: 'PHASE LOCK', x: 74, y: 59 },
        { id: 'EXIT', locks: ['S8', 'S9'], anyLocks: ['D3', 'D4'], label: 'VAULT', x: 93, y: 52, exit: true }
      ]
    },

    /* ---------------------------------------------------------- annex */
    /* Labs 1-8 are the required set. Everything below is an optional annex
     * that only adds mechanics; nothing above is changed to accommodate it.  */

    /* -------------------------------------------------------------- 9 */
    {
      id: 9,
      annex: true,
      name: 'INTERFERENCE',
      zone: 'COHERENCE BENCH',
      intro: 'Two roads to |1\u27e9. Only one of them is certain.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '0', x: 24, y: 26 },
        { id: 'B', label: 'NODE B', state: '0', x: 24, y: 74 }
      ],
      devices: [
        { id: 'H_A', node: 'A', type: 'H', label: 'H GATE \u00b7 A', x: 42, y: 12 },
        { id: 'P_A', node: 'A', type: 'PHASE', label: 'PHASE INVERTER \u00b7 A', x: 42, y: 40 },
        { id: 'H_B', node: 'B', type: 'H', label: 'H GATE \u00b7 B', x: 42, y: 74 },
        { id: 'RV_A', node: 'A', type: 'REINIT', label: 'RE-INIT \u00b7 A', x: 9, y: 26 },
        { id: 'RV_B', node: 'B', type: 'REINIT', label: 'RE-INIT \u00b7 B', x: 9, y: 74 }
      ],
      switches: [],
locks: [
        stateLock('S1', 'A', '+', [], '1 \u00b7 A must be |+\u27e9 (prepare it, do not read it)'),
        stateLock('S2', 'A', '-', ['S1'], '2 \u00b7 A must be |\u2212\u27e9 (invert the phase)'),
        stateLock('S3', 'A', '1', ['S2'], '3 \u00b7 A must be |1\u27e9 (recombine)'),
        readout('S4', 'A', 'Z', ['1'], ['S3'], '4 \u00b7 A in Z \u2192 1 (certain)'),
        stateLock('S5', 'B', '+', ['S4'], '5 \u00b7 B must be |+\u27e9')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'COHERENCE', x: 62, y: 26 },
        { id: 'D2', locks: ['S2', 'S3', 'S4'], label: 'SINGLE READ', x: 62, y: 74 },
        { id: 'EXIT', locks: ['S1', 'S2', 'S3', 'S4', 'S5'], label: 'ANNEX', x: 93, y: 52, exit: true }
      ]
    },

    /* ------------------------------------------------------------- 10 */
    {
      id: 10,
      annex: true,
      register: { qubits: 2, pairs: [['A', 'B']], prepare: 'BELL' },
      name: 'CORRELATION',
      zone: 'PAIR BAY',
      intro: 'Each qubit alone is a coin flip. The two never disagree.',
      nodes: [
        { id: 'A', label: 'NODE A', state: 'mixed', x: 22, y: 32 },
        { id: 'B', label: 'NODE B', state: 'mixed', x: 22, y: 70 }
      ],
      devices: [
        { id: 'RP', type: 'REPREP', qubits: ['A', 'B'], label: 'RE-PREPARE PAIR', x: 42, y: 51 }
      ],
      switches: [],
      locks: [
        readout('S1', 'A', 'Z', ['0', '1'], [], '1 \u00b7 read NODE A in Z (either result)'),
        matchLock('S2', 'B', 'A', 'Z', ['S1'], '2 \u00b7 NODE B in Z must repeat NODE A'),
        gateLock('S3', 'RP', 'A', ['S2'], '3 \u00b7 re-prepare the pair before the second round'),
        readout('S4', 'A', 'X', ['+', '-'], ['S3'], '4 \u00b7 read NODE A in X (either result)'),
        matchLock('S5', 'B', 'A', 'X', ['S4'], '5 \u00b7 NODE B in X must repeat NODE A')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'FIRST READ', x: 64, y: 32 },
        { id: 'D2', locks: ['S2'], label: 'Z AGREEMENT', x: 64, y: 70 },
        { id: 'D3', locks: ['S3'], label: 'RE-PREPARED', x: 64, y: 88 },
        { id: 'EXIT', locks: ['S1', 'S2', 'S3', 'S4', 'S5'], label: 'ANNEX', x: 93, y: 52, exit: true }
      ]
    },

    /* ------------------------------------------------------------- 11 */
    {
      id: 11,
      annex: true,
      name: 'SURVEY',
      zone: 'SAMPLE BAY',
      intro: 'Evidence costs the sample.',
      nodes: [
        { id: 'A', label: 'NODE A', state: '+', x: 24, y: 32 },
        { id: 'B', label: 'NODE B', state: '0', x: 24, y: 72 }
      ],
      devices: [
        { id: 'SV_A', node: 'A', type: 'SURVEY', basis: 'Z', trials: 12, label: 'SPECTROMETER \u00b7 A', x: 42, y: 32 },
        { id: 'SV_B', node: 'B', type: 'SURVEY', basis: 'Z', trials: 12, label: 'SPECTROMETER \u00b7 B', x: 42, y: 72 },
        { id: 'H_A', node: 'A', type: 'H', label: 'H GATE \u00b7 A', x: 42, y: 16 },
        { id: 'RV_A', node: 'A', type: 'REINIT', label: 'RE-INIT \u00b7 A', x: 9, y: 32 },
        { id: 'RV_B', node: 'B', type: 'REINIT', label: 'RE-INIT \u00b7 B', x: 9, y: 72 }
      ],
      switches: [],
      locks: [
        gateLock('S1', 'SV_A', 'A', [], '1 \u00b7 survey NODE A in Z (12 readouts)'),
        readout('S2', 'A', 'Z', ['0', '1'], ['S1'], '2 \u00b7 read NODE A in Z (either result)'),
        gateLock('S3', 'SV_B', 'B', ['S2'], '3 \u00b7 survey NODE B in Z (12 readouts)'),
        readout('S4', 'B', 'Z', ['0', '1'], ['S3'], '4 \u00b7 read NODE B in Z (either result)')
      ],
      doors: [
        { id: 'D1', locks: ['S1'], label: 'SURVEY DONE', x: 64, y: 32 },
        { id: 'D2', locks: ['S2'], label: 'SAMPLE READ', x: 64, y: 56 },
        { id: 'EXIT', locks: ['S1', 'S2', 'S3', 'S4'], label: 'ANNEX', x: 93, y: 52, exit: true }
      ]
    }
  ]

  return LEVELS
})
