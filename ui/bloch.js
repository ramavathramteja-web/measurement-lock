/*
 * ui/bloch.js — the room's Bloch sphere.
 *
 * Pure presentation. It reads the qubit's amplitudes and draws where the state
 * vector points, plus its projection onto the Z and X axes. That single image
 * is what makes "one state, many bases" visible: the vector is fixed, only the
 * axis you project onto changes.
 *
 * For a real qubit a|0> + b|1> with real amplitudes:
 *     x = 2ab   (the X expectation value, so (x+1)/2 is P(+))
 *     z = a^2 - b^2   (the Z expectation value, so (z+1)/2 is P(0))
 *     y = 0, which holds because every gate in this game is real.
 *
 * No physics lives here. If the drawing is ever wrong it is this file's bug,
 * never qubit.js's.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.ML = root.ML || {}
    var ui = root.ML.ui = root.ML.ui || {}
    ui.Bloch = factory().Bloch
    ui.blochVector = factory().blochVector
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  var STATE_COLOR = {
    '0': '#4fe3ff',
    '1': '#b47bff',
    '+': '#5dff9b',
    '-': '#ffb44f'
  }

  var AXIS_Z = '#4fe3ff'
  var AXIS_X = '#ff8ad2'

  /**
   * Bloch coordinates of a qubit.
   * @returns {{x:number,y:number,z:number}} each in [-1,1]
   */
  function blochVector (qubit) {
    var a = qubit._a
    var b = qubit._b
    return { x: 2 * a * b, y: 0, z: a * a - b * b }
  }

  /**
   * Draws into a canvas and redraws on demand.
   * @param {HTMLCanvasElement} canvas
   * @param {number} [size=132]
   */
  function Bloch (canvas, size) {
    this.canvas = canvas
    this.size = size || 132
    this.ctx = canvas.getContext('2d')
    this.qubit = null
    this.hover = null
    this._resize()
  }

  Bloch.prototype._resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    var css = this.size
    this.canvas.width = Math.round(css * dpr)
    this.canvas.height = Math.round(css * dpr)
    this.canvas.style.width = css + 'px'
    this.canvas.style.height = css + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.css = css
  }

  /** @param {Qubit} qubit @param {string} [hoverBasis] 'Z' or 'X' to highlight */
  Bloch.prototype.set = function (qubit, hoverBasis) {
    this.qubit = qubit
    this.hover = hoverBasis || null
    this.draw()
    return this
  }

  Bloch.prototype.draw = function () {
    var ctx = this.ctx
    var s = this.css
    var cx = s / 2
    var cy = s / 2
    var r = s * 0.34

    ctx.clearRect(0, 0, s, s)

    // --- sphere shell -------------------------------------------------
    ctx.save()
    ctx.strokeStyle = 'rgba(120,160,210,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()

    // equator, drawn as a flattened ellipse to read as a 3-D sphere
    ctx.strokeStyle = 'rgba(120,160,210,0.18)'
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.26, 0, 0, Math.PI * 2)
    ctx.stroke()

    // meridian
    ctx.beginPath()
    ctx.ellipse(cx, cy, r * 0.26, r, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // --- axes ---------------------------------------------------------
    axis(ctx, cx, cy, 0, -r, AXIS_Z, 'Z')
    axis(ctx, cx, cy, -r, 0, AXIS_X, 'X')

    if (!this.qubit) return

    var v = blochVector(this.qubit)
    var px = cx + v.x * r
    var py = cy - v.z * r

    // --- projections --------------------------------------------------
    // onto Z: the dashed drop tells you where Z would land
    dashed(ctx, cx, cy, cx, py, AXIS_Z, this.hover === 'Z')
    // onto X: the same for the X basis
    dashed(ctx, cx, cy, px, cy, AXIS_X, this.hover === 'X')

    // --- the state vector ---------------------------------------------
    var color = STATE_COLOR[this.qubit.getState()] || '#ffffff'
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 10
    ctx.strokeStyle = color
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(px, py)
    ctx.stroke()
    ctx.restore()

    // arrow head
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(Math.atan2(py - cy, px - cx))
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-7, -3.4)
    ctx.lineTo(-7, 3.4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // tip dot
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(px, py, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  function axis (ctx, cx, cy, dx, dy, color, label) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.45
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - dx, cy - dy)
    ctx.lineTo(cx + dx, cy + dy)
    ctx.stroke()

    ctx.globalAlpha = 0.85
    ctx.fillStyle = color
    ctx.font = '9px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx + dx * 1.32, cy + dy * 1.32)
    ctx.restore()
  }

  function dashed (ctx, x1, y1, x2, y2, color, strong) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = strong ? 0.95 : 0.4
    ctx.lineWidth = strong ? 1.8 : 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.restore()
  }

  return { Bloch: Bloch, blochVector: blochVector, STATE_COLOR: STATE_COLOR }
})
