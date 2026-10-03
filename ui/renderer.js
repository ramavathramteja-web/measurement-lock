/*
 * ui/renderer.js — everything you see.
 *
 * Builds the room DOM (nodes, devices, switches, doors), draws particle and
 * beam effects on a canvas overlay, and renders the readout / objective /
 * history panels. It only reads from a Puzzle snapshot; it never mutates
 * quantum state.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var ui = root.ML.ui = root.ML.ui || {}
    var api = factory()
    ui.Renderer = api.Renderer
    ui.STATE_COLOR = api.STATE_COLOR
    ui.BASIS_COLOR = api.BASIS_COLOR
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  var STATE_COLOR = {
    '0': '#4fe3ff',
    '1': '#b47bff',
    '+': '#5dff9b',
    '-': '#ffb44f',
    '\u03c8': '#ffffff',
    'mixed': '#8be0ff'
  }

  var BASIS_COLOR = { Z: '#4fe3ff', X: '#ff8ad2' }

  var KET = { '0': '|0\u27e9', '1': '|1\u27e9', '+': '|+\u27e9', '-': '|\u2212\u27e9', 'mixed': 'MIXED' }
  function ketOf (s) { return KET[s] || s }

  function pct (n) { return (Math.round(n * 1000) / 1000) + '%' }

  function el (tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined && text !== null) e.textContent = text
    return e
  }

  function Renderer (opts) {
    opts = opts || {}
    this.root = opts.root || document
    this.bloch = opts.bloch || (window.ML && window.ML.ui ? window.ML.ui.Bloch : null)
    this.dom = {
      levelTitle: document.getElementById('level-title'),
      levelDots: document.getElementById('level-dots'),
      intro: document.getElementById('level-intro'),
      stage: document.getElementById('stage'),
      room: document.getElementById('room'),
      canvas: document.getElementById('fx'),
      toast: document.getElementById('toast'),
      overlay: document.getElementById('overlay'),
      objectives: document.getElementById('objective-list'),
      objectivesHead: document.getElementById('objectives-count'),
      readout: document.getElementById('readout'),
      history: document.getElementById('history'),
      stats: document.getElementById('lab-stats'),
      btnMeasureZ: document.getElementById('btn-measure-z'),
      btnMeasureX: document.getElementById('btn-measure-x'),
      btnReset: document.getElementById('btn-reset'),
      btnNext: document.getElementById('btn-next'),
      btnPrev: document.getElementById('btn-prev')
    }

    this.ctx = this.dom.canvas.getContext('2d')
    this.particles = []
    this.rings = []
    this.beams = []
    this.glows = {}
    this.snapshot = null
    this.level = null
    this.nodesEls = {}
    this.doorsEls = {}
    this.switchEls = {}
    this.deviceEls = {}

    var self = this
    window.addEventListener('resize', function () { self.resize() })
    this.resize()
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  /* ------------------------------------------------------------------ *
   * Canvas
   * ------------------------------------------------------------------ */

  Renderer.prototype.resize = function () {
    var c = this.dom.canvas
    var stage = this.dom.stage
    if (!c || !stage) return
    var rect = stage.getBoundingClientRect()
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.max(1, Math.round(rect.width * dpr))
    c.height = Math.max(1, Math.round(rect.height * dpr))
    c.style.width = rect.width + 'px'
    c.style.height = rect.height + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.w = rect.width
    this.h = rect.height
    var roomRect = this.dom.room.getBoundingClientRect()
    this.roomBox = {
      x: roomRect.left - rect.left,
      y: roomRect.top - rect.top,
      w: roomRect.width,
      h: roomRect.height
    }
  }

  Renderer.prototype.posOf = function (item) {
    var box = this.roomBox || { x: 0, y: 0, w: this.w, h: this.h }
    return {
      x: box.x + (item.x / 100) * box.w,
      y: box.y + (item.y / 100) * box.h
    }
  }

  Renderer.prototype.nodePos = function (id) {
    if (!this.level) return { x: 0, y: 0 }
    var n = this.level.nodes.filter(function (d) { return d.id === id })[0]
    if (!n) return { x: 0, y: 0 }
    return this.posOf(n)
  }

  Renderer.prototype.doorPos = function (id) {
    if (!this.level) return { x: 0, y: 0 }
    var d = this.level.doors.filter(function (x) { return x.id === id })[0]
    if (!d) return { x: 0, y: 0 }
    return this.posOf(d)
  }

  Renderer.prototype.burst = function (x, y, color, count) {
    count = count || 26
    for (var i = 0; i < count; i++) {
      var a = (Math.PI * 2 * i) / count + Math.random() * 0.4
      var sp = 1.4 + Math.random() * 3.4
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.018 + Math.random() * 0.02,
        size: 1 + Math.random() * 2.2,
        color: color
      })
    }
  }

  Renderer.prototype.ring = function (x, y, color, maxR) {
    this.rings.push({ x: x, y: y, r: 6, max: maxR || 74, life: 1, color: color })
  }

  Renderer.prototype.beam = function (a, b, color) {
    this.beams.push({ a: a, b: b, life: 1, decay: 0.012, color: color })
  }

  Renderer.prototype.glow = function (id, color) {
    this.glows[id] = { color: color, life: 1 }
  }

  Renderer.prototype._loop = function () {
    var ctx = this.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, this.w, this.h)

    // ambient dust, so the room reads as a volume rather than a flat grid
    if (!this.dust) this.dust = []
    while (this.dust.length < 46) {
      this.dust.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 0.16,
        vy: -0.05 - Math.random() * 0.16,
        r: 0.4 + Math.random() * 1.1,
        a: 0.05 + Math.random() * 0.16,
        p: Math.random() * 6.28
      })
    }
    for (var d = 0; d < this.dust.length; d++) {
      var m = this.dust[d]
      m.x += m.vx
      m.y += m.vy
      if (m.y < -4) { m.y = this.h + 4; m.x = Math.random() * this.w }
      if (m.x < -4) m.x = this.w + 4
      if (m.x > this.w + 4) m.x = -4
      m.p += 0.02
      ctx.save()
      ctx.globalAlpha = m.a * (0.65 + 0.35 * Math.sin(m.p))
      ctx.fillStyle = '#9fd8ff'
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    var i
    for (i = this.rings.length - 1; i >= 0; i--) {
      var rg = this.rings[i]
      rg.r += (rg.max - rg.r) * 0.14
      rg.life -= 0.022
      if (rg.life <= 0) { this.rings.splice(i, 1); continue }
      ctx.save()
      ctx.globalAlpha = Math.max(0, rg.life) * 0.85
      ctx.strokeStyle = rg.color
      ctx.lineWidth = 2 + rg.life * 2
      ctx.beginPath()
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    for (i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i]
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.97
      p.vy *= 0.97
      p.life -= p.decay
      if (p.life <= 0) { this.particles.splice(i, 1); continue }
      ctx.save()
      ctx.globalAlpha = Math.max(0, p.life)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life + 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    for (i = this.beams.length - 1; i >= 0; i--) {
      var b = this.beams[i]
      b.life -= b.decay
      if (b.life <= 0) { this.beams.splice(i, 1); continue }
      ctx.save()
      ctx.globalAlpha = Math.max(0, b.life) * 0.9
      ctx.strokeStyle = b.color
      ctx.lineWidth = 2
      ctx.setLineDash([12, 10])
      ctx.lineDashOffset = -b.life * 260
      ctx.beginPath()
      ctx.moveTo(b.a.x, b.a.y)
      ctx.lineTo(b.b.x, b.b.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    for (var id in this.glows) {
      var g = this.glows[id]
      g.life -= 0.03
      if (g.life <= 0) delete this.glows[id]
    }

    requestAnimationFrame(this._loop)
  }

  /* ------------------------------------------------------------------ *
   * Room construction
   * ------------------------------------------------------------------ */

  Renderer.prototype.build = function (level, snapshot) {
    this.level = level
    var room = this.dom.room
    room.innerHTML = ''
    this.nodesEls = {}
    this.doorsEls = {}
    this.switchEls = {}
    this.deviceEls = {}

    // doors first so nodes draw above them
    level.doors.forEach(this._buildDoor, this)
    level.nodes.forEach(this._buildNode, this)
    ;(level.switches || []).forEach(this._buildSwitch, this)
    ;(level.devices || []).forEach(this._buildDevice, this)

    this.dom.levelTitle.textContent =
      'LAB ' + String(level.id).padStart(2, '0') + ' \u00b7 ' + level.name
    this.dom.intro.textContent = level.intro
    document.body.classList.toggle('final-lab', level.id === 8)
    this.resize()
    this.render(snapshot)
  }

  Renderer.prototype._place = function (node, item) {
    node.style.left = pct(item.x)
    node.style.top = pct(item.y)
  }

  Renderer.prototype._buildDoor = function (def) {
    var d = el('div', 'door' + (def.exit ? ' door-exit' : ''))
    d.dataset.door = def.id
    this._place(d, def)
    var frame = el('div', 'door-frame')
    var panelL = el('div', 'door-panel')
    var panelR = el('div', 'door-panel')
    frame.appendChild(panelL)
    frame.appendChild(panelR)
    d.appendChild(frame)

    var plate = el('div', 'door-plate')
    plate.appendChild(el('span', 'door-name', def.label))
    var req = el('span', 'door-req')
    plate.appendChild(req)
    d.appendChild(plate)

    var beam = el('div', 'door-beam')
    d.appendChild(beam)

    this.dom.room.appendChild(d)
    this.doorsEls[def.id] = { root: d, req: req, beam: beam }
  }

  Renderer.prototype._buildNode = function (def) {
    var n = el('div', 'qnode')
    n.dataset.node = def.id
    this._place(n, def)

    n.appendChild(el('div', 'qnode-halo'))
    n.appendChild(el('div', 'qnode-core'))
    var ket = el('div', 'qnode-ket', ketOf(def.state))
    n.appendChild(ket)
    n.appendChild(el('div', 'qnode-label', def.label))

    var btns = el('div', 'qnode-buttons')
    var bz = el('button', 'mbtn mbtn-z', 'Z')
    bz.dataset.measure = 'Z'
    bz.dataset.node = def.id
    var bx = el('button', 'mbtn mbtn-x', 'X')
    bx.dataset.measure = 'X'
    bx.dataset.node = def.id
    btns.appendChild(bz)
    btns.appendChild(bx)
    n.appendChild(btns)

    var lock = el('div', 'qnode-lock')
    lock.appendChild(el('span', '', 'NO POWER'))
    n.appendChild(lock)

    this.dom.room.appendChild(n)
    this.nodesEls[def.id] = { root: n, ket: ket, bz: bz, bx: bx, lock: lock, halo: n.querySelector('.qnode-halo') }
  }

  Renderer.prototype._buildSwitch = function (def) {
    var s = el('div', 'switch')
    s.dataset.switch = def.id
    this._place(s, def)
    var lever = el('div', 'switch-lever')
    lever.appendChild(el('div', 'switch-knob'))
    s.appendChild(lever)
    s.appendChild(el('div', 'switch-label', def.label))
    this.dom.room.appendChild(s)
    this.switchEls[def.id] = { root: s, lever: lever }
  }

  Renderer.prototype._buildDevice = function (def) {
    var d = el('button', 'device device-' + def.type.toLowerCase())
    d.dataset.device = def.id
    d.dataset.node = def.node
    this._place(d, def)
    var glyph = { H: 'H', PHASE: '\u03c6', NOT: '\u00ac', REINIT: '\u21ba', REPREP: '\u21bb', SURVEY: '\u25a6' }[def.type] || '?'
    d.appendChild(el('span', 'device-glyph', glyph))
    d.appendChild(el('span', 'device-label', def.label))
    this.dom.room.appendChild(d)
    this.deviceEls[def.id] = d
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  Renderer.prototype.render = function (snap) {
    if (!snap) return
    this.snapshot = snap

    snap.nodes.forEach(this._renderNode, this)
    snap.doors.forEach(this._renderDoor, this)
    snap.switches.forEach(this._renderSwitch, this)
    snap.devices = (snap.level.devices || [])
    snap.devices.forEach(this._renderDevice, this)

    this._renderObjectives(snap)
    this._renderReadout(snap)
    this._renderHistory(snap)
    this._renderControls(snap)
  }

  Renderer.prototype._renderNode = function (n) {
    var e = this.nodesEls[n.id]
    if (!e) return
    e.ket.textContent = ketOf(n.state)
    e.root.style.setProperty('--state-color', STATE_COLOR[n.state] || '#fff')
    e.root.classList.toggle('is-selected', n.selected)
    e.root.classList.toggle('is-locked', n.locked)
    e.root.classList.toggle('is-measured', n.measurements > 0)

    var disabled = n.locked
    e.bz.disabled = disabled
    e.bx.disabled = disabled
    if (disabled) {
      e.lock.classList.add('on')
    } else {
      e.lock.classList.remove('on')
    }
  }

  Renderer.prototype._renderDoor = function (d) {
    var e = this.doorsEls[d.id]
    if (!e) return
    e.root.classList.toggle('is-open', d.open)
    if (d.open) {
      e.req.textContent = 'OPEN'
    } else {
      var missing = []
      missing = (d.def.locks || []).slice()
      if ((d.def.anyLocks || []).length) missing.push('one of ' + d.def.anyLocks.join('/'))
      e.req.textContent = missing.length ? 'needs ' + missing.join(' + ') : 'sealed'
    }
  }

  Renderer.prototype._renderSwitch = function (s) {
    var e = this.switchEls[s.id]
    if (!e) return
    e.root.classList.toggle('is-powered', s.powered)
    e.root.classList.toggle('is-enabled', s.enabled && !s.powered)
    e.root.classList.toggle('is-dead', !s.enabled && !s.powered)
  }

  Renderer.prototype._renderDevice = function (def) {
    var node = this.snapshot.nodes.filter(function (n) { return n.id === def.node })[0]
    var e = this.deviceEls[def.id]
    if (!e || !node) return
    e.disabled = node.locked
    e.classList.toggle('is-dim', node.locked)
  }

  Renderer.prototype._renderObjectives = function (snap) {
    var list = this.dom.objectives
    list.innerHTML = ''
    var left = snap.locks.filter(function (l) { return !l.satisfied }).length

    snap.locks.forEach(function (l, i) {
      var li = el('li', 'obj' + (l.satisfied ? ' is-done' : '') + (l.armed ? ' is-armed' : ' is-waiting'))
      li.appendChild(el('span', 'obj-step', String(i + 1).padStart(2, '0')))
      var body = el('div', 'obj-body')
      body.appendChild(el('div', 'obj-label', l.label))
      var sub = el('div', 'obj-sub')
      if (l.satisfied) {
        sub.textContent = 'SATISFIED'
      } else if (l.armed) {
        if (l.kind === 'echo') sub.textContent = 'AWAITING REPEAT'
        else if (l.kind === 'state') sub.textContent = 'AWAITING STATE ' + ketOf(l.def.state)
        else sub.textContent = 'ARMED \u2014 waiting for the right readout'
      } else if (l.blockedBy.length) {
        sub.textContent = 'LOCKED BY STEP ' + l.blockedBy.map(function (b) {
          var idx = snap.locks.map(function (x) { return x.id }).indexOf(b)
          return String(idx + 1).padStart(2, '0')
        }).join(', ')
      } else {
        sub.textContent = 'ARMED'
      }
      body.appendChild(sub)
      li.appendChild(body)
      var chip = el('span', 'obj-chip', l.satisfied ? 'OPEN' : (l.armed ? 'READY' : 'LOCKED'))
      li.appendChild(chip)
      list.appendChild(li)
    })

    if (this.dom.objectivesHead) {
      this.dom.objectivesHead.textContent = left === 0 ? 'ALL CONDITIONS MET' : left + ' CONDITION' + (left === 1 ? '' : 'S') + ' LEFT'
    }
  }

  Renderer.prototype._renderReadout = function (snap) {
    var box = this.dom.readout
    box.innerHTML = ''
    var node = snap.nodes.filter(function (n) { return n.id === snap.selected })[0]

    if (!node) {
      box.appendChild(el('div', 'ro-empty', 'NO NODE SELECTED \u2014 click a node in the room'))
      return
    }

    var head = el('div', 'ro-head')
    head.appendChild(el('span', 'ro-node', node.label))
    var ket = el('span', 'ro-ket', node.ket)
    ket.style.color = STATE_COLOR[node.state] || '#fff'
    head.appendChild(ket)
    box.appendChild(head)

    if (node.locked) {
      box.appendChild(el('div', 'ro-locked', 'NO POWER \u2014 this node cannot be read yet'))
      return
    }

    var q = node.qubit
    var self = this

    // the Bloch sphere: one vector, two axes
    if (this.bloch) {
      var sphere = el('div', 'ro-sphere')
      var canvas = el('canvas', 'ro-bloch')
      sphere.appendChild(canvas)
      var caption = el('div', 'ro-sphere-cap', 'same vector, two axes')
      sphere.appendChild(caption)
      box.appendChild(sphere)

      var inst = new this.bloch(canvas, 112)
      inst.set(q, null)
      this.blochView = inst

      // hovering a probability row lights up the matching axis projection
      var pair = { Z: null, X: null }
      box.addEventListener('mouseover', function (ev) {
        var row = ev.target.closest ? ev.target.closest('.ro-row') : null
        if (!row) return
        var basis = row.firstChild && row.firstChild.textContent
        if (basis !== 'Z' && basis !== 'X') return
        pair[basis] = true
        inst.set(q, basis)
      })
      box.addEventListener('mouseout', function (ev) {
        if (ev.target.closest && !ev.target.closest('.ro-row')) return
        pair.Z = null
        pair.X = null
        inst.set(q, null)
      })
    }

    ;['Z', 'X'].forEach(function (basis) {
      var results = basis === 'Z' ? ['0', '1'] : ['+', '-']
      var p = q.probabilities(basis)
      var certain = q.isDeterministicIn(basis)

      var row = el('div', 'ro-row is-action')
      row.title = 'measure ' + node.id + ' in basis ' + basis

      var lab = el('span', 'ro-basis', basis)
      lab.style.color = BASIS_COLOR[basis]
      row.appendChild(lab)

      var bar = el('div', 'ro-bar')
      results.forEach(function (res) {
        var seg = el('div', 'ro-seg')
        seg.style.width = pct(p[res] * 100)
        seg.style.background = STATE_COLOR[res] || '#fff'
        seg.title = res + ' \u00b7 ' + pct(p[res] * 100)
        bar.appendChild(seg)
      })
      row.appendChild(bar)

      row.appendChild(el('span', 'ro-value', results.map(function (res) {
        return res + ' ' + pct(p[res] * 100)
      }).join('  ')))

      row.appendChild(el('span', 'ro-tag' + (certain ? ' is-certain' : ''), certain ? 'CERTAIN' : 'RANDOM'))
      row.addEventListener('click', function () {
        if (self.onMeasure) self.onMeasure(node.id, basis)
      })
      box.appendChild(row)
    })

    var meta = el('div', 'ro-meta')
    var started = ketOf(node.def.state)
    meta.appendChild(el('span', null, 'STARTED ' + started))
    var m = q.getMeasurementHistory().length
    meta.appendChild(el('span', null, m + ' READOUT' + (m === 1 ? '' : 'S')))
    box.appendChild(meta)
  }

  Renderer.prototype._renderHistory = function (snap) {
    var list = this.dom.history
    list.innerHTML = ''
    var events = snap.events
    if (!events.length) {
      var li = el('li', 'hist-empty', 'no readouts yet')
      list.appendChild(li)
      return
    }

    // a long session would otherwise build thousands of rows; keep the most
    // recent window, which is the only part anyone reads
    var MAX_ROWS = 200
    var start = Math.max(0, events.length - MAX_ROWS)
    if (start > 0) {
      var skip = el('li', 'hist-empty', '\u00b7 \u00b7 \u00b7 ' + start + ' earlier events \u00b7 \u00b7 \u00b7')
      list.appendChild(skip)
    }

    for (var i = start; i < events.length; i++) {
      var ev = events[i]
      var li = el('li', 'hist' + (ev.type === 'gate' ? ' hist-gate' : '') +
        (ev.type === 'survey' ? ' hist-survey' : ''))
      li.appendChild(el('span', 'hist-seq', String(i + 1).padStart(2, '0')))
      var body = el('span', 'hist-body')
      if (ev.type === 'measure') {
        var basis = el('b', 'hist-basis', ev.basis)
        basis.style.color = BASIS_COLOR[ev.basis]
        body.appendChild(document.createTextNode(ev.nodeId + ' in '))
        body.appendChild(basis)
        body.appendChild(document.createTextNode(' \u2192 '))
        var res = el('b', 'hist-result', ev.result)
        res.style.color = STATE_COLOR[ev.result] || '#fff'
        body.appendChild(res)
        var p = el('span', 'hist-prob', '  ' + pct(ev.probability * 100))
        body.appendChild(p)
      } else if (ev.type === 'survey') {
        var tally = Object.keys(ev.counts).map(function (k) {
          return k + '\u00d7' + ev.counts[k]
        }).join('  ')
        body.appendChild(document.createTextNode(ev.nodeId + ' \u00b7 ' + ev.gateLabel + ' ' + ev.basis + ' \u00b7 '))
        var t = el('b', 'hist-result', tally)
        t.style.color = '#ffb44f'
        body.appendChild(t)
      } else {
        body.appendChild(document.createTextNode(ev.nodeId + ' \u00b7 ' + ev.gateLabel + ' \u2192 '))
        var ks = el('b', 'hist-result', ev.ket)
        ks.style.color = STATE_COLOR[ev.stateAfter] || '#fff'
        body.appendChild(ks)
      }
      li.appendChild(body)
      list.appendChild(li)
    }
    if (list.parentNode) list.parentNode.scrollTop = list.parentNode.scrollHeight
  }

  Renderer.prototype._renderControls = function (snap) {
    var node = snap.nodes.filter(function (n) { return n.id === snap.selected })[0]
    var disabled = !node || node.locked
    this.dom.btnMeasureZ.disabled = disabled
    this.dom.btnMeasureX.disabled = disabled
    var tag = this.dom.btnMeasureZ.parentNode.querySelector('.target-tag')
    if (tag) tag.textContent = node ? (node.locked ? 'NO POWER' : node.label) : '\u2014'

    var zLocks = snap.locks.filter(function (l) {
      return l.def.kind !== 'gate' && l.def.basis === 'Z'
    })
    var xLocks = snap.locks.filter(function (l) {
      return l.def.kind !== 'gate' && l.def.basis === 'X'
    })
    this.dom.btnMeasureZ.dataset.sub = this._requirementText(zLocks)
    this.dom.btnMeasureX.dataset.sub = this._requirementText(xLocks)
  }

  Renderer.prototype._requirementText = function (locks) {
    var armed = locks.filter(function (l) { return l.armed && !l.satisfied })
    if (!armed.length) return 'no lock waiting'
    return armed.map(function (l) { return l.def.node + ' ' + l.def.basis + ' ' + (l.def.accept || []).join('/') })
      .join('  \u00b7  ')
  }

  /* ------------------------------------------------------------------ *
   * Feedback
   * ------------------------------------------------------------------ */

  Renderer.prototype.showMeasurement = function (info) {
    var toast = this.dom.toast
    toast.innerHTML = ''
    toast.className = 'toast is-live'

    var head = el('div', 'toast-head')
    head.appendChild(el('span', 'toast-node', info.nodeId))
    var basis = el('span', 'toast-basis', 'BASIS ' + info.basis)
    basis.style.color = BASIS_COLOR[info.basis]
    head.appendChild(basis)
    head.appendChild(el('span', 'toast-prob', info.certain ? '100%' : pct(info.probability * 100)))
    toast.appendChild(head)

    var res = el('div', 'toast-result')
    res.appendChild(el('span', 'toast-k', 'RESULT'))
    var r = el('b', 'toast-r', info.result)
    r.style.color = STATE_COLOR[info.result] || '#fff'
    res.appendChild(r)
    toast.appendChild(res)

    var st = el('div', 'toast-state')
    st.appendChild(el('span', 'toast-k', 'STATE'))
    st.appendChild(el('b', null, info.certain ? 'UNCHANGED \u2192 ' + info.ket : 'COLLAPSED \u2192 ' + info.ket))
    toast.appendChild(st)

    var p = this.nodePos(info.nodeId)
    var color = BASIS_COLOR[info.basis]
    this.burst(p.x, p.y, color, info.certain ? 14 : 34)
    this.ring(p.x, p.y, color, info.certain ? 56 : 92)
    this.burst(p.x, p.y, STATE_COLOR[info.result] || '#fff', info.certain ? 10 : 22)
    this.glow(info.nodeId, color)

    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () { toast.className = 'toast' }, 2600)
  }

  Renderer.prototype.showBlocked = function (info) {
    var toast = this.dom.toast
    toast.innerHTML = ''
    toast.className = 'toast is-live is-blocked'
    toast.appendChild(el('div', 'toast-blocked', info.reason))
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () { toast.className = 'toast' }, 2200)

    // flash the room edge so a refused action is felt, not just read
    document.body.classList.add('is-blocked')
    var self = this
    clearTimeout(this._blockTimer)
    this._blockTimer = setTimeout(function () {
      document.body.classList.remove('is-blocked')
      void self
    }, 260)
  }

  Renderer.prototype.showGate = function (info) {
    var toast = this.dom.toast
    toast.innerHTML = ''
    toast.className = 'toast is-live is-gate'
    var head = el('div', 'toast-head')
    head.appendChild(el('span', 'toast-node', info.nodeId))
    head.appendChild(el('span', 'toast-basis', info.gateLabel))
    head.appendChild(el('span', 'toast-prob', 'STATE PREPARED'))
    toast.appendChild(head)
    var st = el('div', 'toast-state')
    st.appendChild(el('span', 'toast-k', 'STATE'))
    var b = el('b', null, info.ket)
    b.style.color = STATE_COLOR[info.stateAfter] || '#fff'
    st.appendChild(b)
    toast.appendChild(st)

    var p = this.nodePos(info.nodeId)
    this.ring(p.x, p.y, '#9ad9ff', 62)
    this.burst(p.x, p.y, '#9ad9ff', 18)
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () { toast.className = 'toast' }, 2200)
  }

  /** Statistics gathered at the cost of the sample that produced them. */
  Renderer.prototype.showSurvey = function (info) {
    var toast = this.dom.toast
    toast.innerHTML = ''
    toast.className = 'toast is-live is-survey'

    var head = el('div', 'toast-head')
    head.appendChild(el('span', 'toast-node', info.nodeId))
    var basis = el('span', 'toast-basis', 'SPECTROMETER ' + info.basis)
    basis.style.color = BASIS_COLOR[info.basis]
    head.appendChild(basis)
    head.appendChild(el('span', 'toast-prob', info.trials + ' READOUTS'))
    toast.appendChild(head)

    var results = info.basis === 'Z' ? ['0', '1'] : ['+', '-']
    var bar = el('div', 'survey-bar')
    var max = 1
    results.forEach(function (r) { max = Math.max(max, info.counts[r] || 0) })

    results.forEach(function (r) {
      var n = info.counts[r] || 0
      var col = el('div', 'survey-col')
      col.style.setProperty('--c', STATE_COLOR[r] || '#fff')
      var fill = el('div', 'survey-fill')
      fill.style.height = Math.round((n / max) * 100) + '%'
      col.appendChild(fill)
      col.appendChild(el('span', 'survey-count', String(n)))
      col.appendChild(el('span', 'survey-ket', r))
      bar.appendChild(col)
    })
    toast.appendChild(bar)

    var st = el('div', 'toast-state')
    st.appendChild(el('span', 'toast-k', 'LEFT'))
    st.appendChild(el('b', null, 'sample collapsed to ' + info.ket))
    toast.appendChild(st)

    var p = this.nodePos(info.nodeId)
    this.burst(p.x, p.y, '#9ad9ff', 24)
    this.ring(p.x, p.y, '#9ad9ff', 84)

    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () { toast.className = 'toast' }, 3600)
  }

  Renderer.prototype.showLock = function (info) {
    var toast = this.dom.toast
    // a survey histogram is worth several seconds of the player's attention,
    // so a lock releasing underneath it must not wipe it out
    if (toast.className.indexOf('is-survey') !== -1) {
      var line = el('div', 'toast-lockline', 'LOCK RELEASED \u00b7 ' + info.label)
      toast.appendChild(line)
      return
    }
    toast.innerHTML = ''
    toast.className = 'toast is-live is-lock'
    toast.appendChild(el('div', 'toast-blocked', 'LOCK RELEASED \u00b7 ' + info.label))
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () { toast.className = 'toast' }, 2400)
  }

  Renderer.prototype.doorOpened = function (info, snap) {
    var target = this.doorPos(info.id)
    var colors = { Z: '#4fe3ff', X: '#ff8ad2' }
    var fromId = null
    if (snap) {
      snap.locks.forEach(function (l) {
        if ((info.def.locks || []).indexOf(l.id) !== -1) fromId = l.def.node || fromId
      })
      if ((info.def.anyLocks || []).length && !fromId) fromId = (snap.level.nodes[0] || {}).id
    }
    if (fromId) {
      this.beam(this.nodePos(fromId), target, info.exit ? '#5dff9b' : (colors[(info.def.locks || []).length ? 'Z' : 'X'] || '#8fe9ff'))
    }
    this.burst(target.x, target.y, info.exit ? '#5dff9b' : '#8fe9ff', 30)
    this.ring(target.x, target.y, info.exit ? '#5dff9b' : '#8fe9ff', info.exit ? 120 : 70)
  }

  /* ------------------------------------------------------------------ *
   * Overlays
   * ------------------------------------------------------------------ */

  Renderer.prototype.hideOverlay = function () {
    this.dom.overlay.className = 'overlay'
    this.dom.overlay.innerHTML = ''
  }

  Renderer.prototype.showLevelComplete = function (opts) {
    var o = this.dom.overlay
    o.className = 'overlay is-live'
    o.innerHTML = ''

    var card = el('div', 'ov-card')
    card.appendChild(el('div', 'ov-kicker', opts.kicker || 'LOCK RELEASED'))
    card.appendChild(el('h2', 'ov-title', opts.title))

    var body = el('div', 'ov-body')
    ;(opts.lines || []).forEach(function (line, i) {
      var cls = 'ov-line' + (opts.quoteIndex === i ? ' is-quote' : '')
      body.appendChild(el('div', cls, line))
    })
    card.appendChild(body)

    var stats = el('div', 'ov-stats')
    ;(opts.stats || []).forEach(function (s) {
      var item = el('div', 'ov-stat')
      item.appendChild(el('div', 'ov-stat-v', s.value))
      item.appendChild(el('div', 'ov-stat-k', s.key))
      stats.appendChild(item)
    })
    card.appendChild(stats)

    var actions = el('div', 'ov-actions')
    var next = el('button', 'btn btn-accent', opts.nextLabel || 'NEXT LEVEL \u2192')
    next.id = 'ov-next'
    actions.appendChild(next)
    if (opts.replayLabel) {
      var again = el('button', 'btn btn-ghost', opts.replayLabel)
      again.id = 'ov-replay'
      actions.appendChild(again)
    }
    card.appendChild(actions)
    o.appendChild(card)

    var self = this
    next.addEventListener('click', function () { self.onNext && self.onNext() })
    var againEl = document.getElementById('ov-replay')
    if (againEl) againEl.addEventListener('click', function () { self.onReset && self.onReset() })
  }

  Renderer.prototype.setDots = function (levels, index, completed) {
    var box = this.dom.levelDots
    box.innerHTML = ''
    levels.forEach(function (l, i) {
      var d = el('span', 'dot' + (i === index ? ' is-current' : '') + (completed[l.id] ? ' is-done' : ''))
      d.title = 'Lab ' + l.id + ' \u00b7 ' + l.name
      box.appendChild(d)
    })
  }

  Renderer.prototype.setStats = function (stats, objectives) {
    if (!this.dom.stats) return
    this.dom.stats.innerHTML = ''
    var obj = objectives || { done: 0, total: 0 }
    var items = [
      { k: 'READOUTS', v: stats.measurements },
      { k: 'CERTAIN', v: stats.certain },
      { k: 'RANDOM', v: stats.probabilistic },
      { k: 'CONDITIONS MET', v: obj.done + '/' + obj.total }
    ]
    items.forEach(function (i) {
      var s = el('span', 'stat')
      s.appendChild(el('b', null, String(i.v)))
      s.appendChild(document.createTextNode(' ' + i.k))
      this.dom.stats.appendChild(s)
    }, this)
  }

  Renderer.prototype.STATE_COLOR = STATE_COLOR
  Renderer.prototype.BASIS_COLOR = BASIS_COLOR

  return { Renderer: Renderer, STATE_COLOR: STATE_COLOR, BASIS_COLOR: BASIS_COLOR }
})
