# MEASUREMENT LOCK

A browser puzzle game where you learn quantum measurement by playing it. There
is no lecture and no quiz. Every rule is a door that only opens if you use the
physics correctly.

Plain HTML, CSS and JavaScript. No backend, no database, no frameworks, no
build step.

## Run it

Double-click `index.html`. That is the whole procedure.

If your browser is unusually strict about local files, serve the folder instead:

```
python -m http.server 8000
```

then open <http://127.0.0.1:8000>.

Append `#lab=9` to the URL to jump straight into a lab.

## Controls

| | |
|---|---|
| `MEASURE Z` / `MEASURE X` | read the selected node in that basis |
| per-node `Z` / `X` buttons | read that node directly |
| `H GATE` | prepares a superposition |
| `PHASE INVERTER` | flips `\|+\u27e9` to `\|\u2212\u27e9` |
| `RE-PREPARE` / `RE-INIT` | rebuilds a sample from scratch |
| `SPECTROMETER` | gathers statistics, and spends the sample doing it |

Keys: `z` `x` measure, `1`–`9` pick a node, `h` H gate, `g` phase, `u` re-init,
`r` reset level, `n` next lab.

## The labs

Labs 1–8 are the required set. Labs 9–11 are an annex that only adds mechanics;
nothing in 1–8 depends on them.

| # | Lab | What it teaches |
|---|---|---|
| 1 | First Lock | `\|0\u27e9` read in Z is certain |
| 2 | Two States | `\|0\u27e9` and `\|1\u27e9` both answer Z |
| 3 | The Surprise | X on `\|0\u27e9` is a coin flip, and either result opens a route |
| 4 | Collapse | the second X readout must repeat the first |
| 5 | Basis Switch | switching basis throws the old certainty away |
| 6 | Wrong Basis | reading in the wrong basis can strand a node for good |
| 7 | Sequence Puzzle | power a bus, prepare a state, read it, flip its phase |
| 8 | Final Measurement Lock | everything at once, in nine ordered conditions |
| 9 | Interference | routing a superposition keeps it certain; measuring it does not |
| 10 | Correlation | two qubits each random alone, never disagreeing together |
| 11 | Survey | evidence costs the sample that produced it |

## Architecture

```
index.html          markup shell
style.css           all styling
main.js             bootstrap, level flow, event wiring

quantum/qubit.js    single-qubit engine: amplitudes, Born rule, collapse, gates
quantum/register.js two-qubit state-vector simulator, Bell pairs, CNOT

game/gameState.js   run progression, stats, progress memory, event emitter
game/levels.js      declarative level table
game/puzzle.js      runtime: locks, doors, switches, devices, register nodes

ui/bloch.js         the Bloch sphere instrument (pure view code)
ui/renderer.js      room DOM, canvas effects, readout / objective / history panels
ui/controls.js      mouse and keyboard input

tests/quantumTests.js  engine rules, collapse, sampling distributions
tests/registerTests.js two-qubit physics and correlation
tests/levelTests.js    level integrity, solvability, exhaustive reachability
tests/browserCheck.html end-to-end play-through in a real browser
```

The quantum engine never touches the DOM, and the UI never computes a
probability. They only meet in `game/puzzle.js`.

### The engine

A qubit is stored as real amplitudes `[a, b]` meaning `a|0> + b|1>`, so all four
basis states fall out of the same arithmetic:

```
|0> = [1, 0]              |1> = [0, 1]
|+> = [1/\u221a2, 1/\u221a2]       |-\u27e9 = [1/\u221a2, -1/\u221a2]
```

Measurement probabilities are computed from those amplitudes with the Born rule
rather than looked up in a table, so the engine stays correct for
superpositions the gates produce. Outcomes are sampled with `Math.random`
(injectable for tests) and the state is then collapsed onto the eigenstate.

## Tests

```
node tests/quantumTests.js
node tests/registerTests.js
node tests/levelTests.js
```

`quantumTests` pins the rule table, collapse, and the 50/50 distributions over
20,000 trials. `registerTests` covers the Bell pair, the singlet, correlation in
both bases, and checks that a one-qubit register agrees exactly with `Qubit`.

`levelTests` is the interesting one. For every lab it builds the **entire
reachable state graph**, then sweeps backwards from every state that already has
its exit open. Any state the sweep cannot reach would be a dead end. It also
replays a hand-written solution 400 times against real `Math.random`, so every
random branch is exercised, and plays each lab with a greedy player.

The search treats `RESET LEVEL` as a legal move, because it is a real button —
so the guarantee it proves is the one that matters: *no reachable state can
soft-lock the player*. It separately asserts that a reset-free route to the
exit exists.

To read the results in a browser, serve the folder and open
`tests/browserCheck.html`. It mirrors `index.html`, loads the real `main.js`,
and plays every lab by clicking the real buttons.

## How the game teaches

Every concept is a mechanism:

- **Certainty vs chance.** Lab 1's lock needs `Z \u2192 0`, which always happens.
  Lab 3's needs an X readout that is 50/50 and opens *either* route. The player
  learns that you cannot choose an outcome.
- **Collapse.** Lab 4 requires two consecutive X readouts on one node to agree.
  The history panel shows `A in X \u2192 \u2212 50%` then `\u2212 100%`, so the
  second certainty is visibly caused by the first measurement.
- **Basis switching.** Lab 5 orders `X \u2192 Z \u2192 Z`. Change the order and
  the step is ignored, and because the node is now `\|+\u27e9` the Z readout is
  random again.
- **Consequence.** Lab 6's first lock needs `Z \u2192 0`. Measure X first and
  the node collapses to `\|\u00b1\u27e9`; a bad landing leaves `\|1\u27e9`, which
  can never read 0 again. A re-init coil exists, so the mistake costs time, not
  the run.
- **Preparation beats randomness.** Lab 7's H gate turns `\|0\u27e9` into `\|+\u27e9`,
  so the X readout becomes 100% `+`. The phase inverter then flips the certain
  answer. Labs 9–10 push this: interference, and two qubits that each look
  random alone but never disagree together.

The Bloch sphere in the readout panel draws the same state vector with its
projections onto both axes, so "one state, many bases" is one picture rather
than a paragraph.

## Notes

- An entangled qubit is drawn as `MIXED`, not given a ket it does not have.
- Probability in the history log is recorded *before* collapse, which is why a
  repeated readout shows 100%.
- Lab 10 is a genuine two-qubit simulation: measuring one qubit really does
  determine the other, and the phase is what decides the answer in the X basis.