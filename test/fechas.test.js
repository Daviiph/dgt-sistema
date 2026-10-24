// Pruebas de fechas: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSaleDate, saleTime, stampCaracas, presetRange, customRange, previousRange, buckets } from '../src/fechas.js'

const iso = (d) => d.toISOString()

test('lee la fecha escrita como hora de Caracas, sin importar la zona del equipo', () => {
  assert.equal(iso(parseSaleDate('14/10/2026, 1:30:53 a.m.')), '2026-10-14T05:30:53.000Z')
  assert.equal(iso(parseSaleDate('18/10/2026, 1:23:58 p.m.')), '2026-10-18T17:23:58.000Z')
  assert.equal(iso(parseSaleDate('20/10/2026, 21:00:28')), '2026-10-21T01:00:28.000Z')
  assert.equal(iso(parseSaleDate('10/15/2026, 7:06:38 PM')), '2026-10-15T23:06:38.000Z')
  assert.equal(iso(parseSaleDate('13/10/2026, 12:05:00 p. m.')), '2026-10-13T16:05:00.000Z')
  assert.equal(parseSaleDate('basura'), null)
  assert.equal(parseSaleDate('31/13/2026'), null)
})

test('venta INV-52645800: equipo con reloj 6 h adelantado → cuenta el 19 (hora real de la nube)', () => {
  const s = { date: '20/10/2026, 1:30:45', createdAt: '2026-10-19T23:30:46.304573+00:00' }
  assert.equal(iso(saleTime(s)), '2026-10-19T23:30:46.304Z')
})

test('venta hecha sin conexión y enviada horas después → vale la hora escrita', () => {
  const s = { date: '19/10/2026, 10:00:00', createdAt: '2026-10-19T20:00:00Z' }
  assert.equal(iso(saleTime(s)), '2026-10-19T14:00:00.000Z')
})

test('venta sin fecha de la nube usa la escrita; sin nada da null', () => {
  assert.equal(iso(saleTime({ date: '01/11/2026, 08:00:00' })), '2026-11-01T12:00:00.000Z')
  assert.equal(saleTime({}), null)
})

test('stampCaracas escribe dd/mm/aaaa, HH:MM:SS en hora de Caracas y se puede volver a leer', () => {
  const t = new Date('2026-10-20T01:30:45Z')
  assert.equal(stampCaracas(t), '19/10/2026, 21:30:45')
  assert.equal(iso(parseSaleDate(stampCaracas(t))), iso(t))
})

// Rangos en hora local del equipo (los usuarios están en Caracas)
const now = new Date(2026, 9, 23, 15, 0, 0) // 23 oct 2026

test('Este mes = 1 al fin de hoy; Mes pasado = mes completo de septiembre', () => {
  const m = presetRange('mes', [], now)
  assert.deepEqual([m.from, m.to].map(d => d.getTime()), [new Date(2026, 9, 1).getTime(), new Date(2026, 9, 24).getTime()])
  const mp = presetRange('mespasado', [], now)
  assert.deepEqual([mp.from, mp.to].map(d => d.getTime()), [new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime()])
})

test('rango personalizado incluye el día final completo y acepta orden invertido', () => {
  const r = customRange(new Date(2026, 9, 30), new Date(2026, 8, 1))
  assert.equal(r.from.getTime(), new Date(2026, 8, 1).getTime())
  assert.equal(r.to.getTime(), new Date(2026, 9, 31).getTime())
})

test('período anterior de un mes completo es el mes anterior completo', () => {
  const r = customRange(new Date(2026, 9, 1), new Date(2026, 9, 31))
  const p = previousRange(r)
  assert.equal(p.from.getTime(), new Date(2026, 8, 1).getTime())
  assert.equal(p.to.getTime(), new Date(2026, 9, 1).getTime())
})

test('período anterior de días sueltos tiene la misma cantidad de días', () => {
  const r = customRange(new Date(2026, 9, 10), new Date(2026, 9, 16))
  const p = previousRange(r)
  assert.equal(p.from.getTime(), new Date(2026, 9, 3).getTime())
  assert.equal(p.to.getTime(), new Date(2026, 9, 10).getTime())
})

test('cubetas: un día → 24 horas; 2 meses → por día; > 62 días → por mes', () => {
  assert.equal(buckets(customRange(now, now)).length, 24)
  assert.equal(buckets(customRange(new Date(2026, 8, 1), new Date(2026, 9, 31))).length, 61)
  assert.equal(buckets(customRange(new Date(2026, 0, 1), new Date(2026, 9, 31))).length, 10)
})
