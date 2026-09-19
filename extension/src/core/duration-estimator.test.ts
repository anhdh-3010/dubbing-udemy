import { describe, expect, it } from 'vitest'
import { DurationEstimator } from './duration-estimator'

describe('DurationEstimator', () => {
  it('ước lượng theo số ký tự và hệ số ban đầu', () => {
    const e = new DurationEstimator(15)
    expect(e.estimate('x'.repeat(30))).toBeCloseTo(2)
  })

  it('hội tụ về tốc độ thật sau vài lần quan sát', () => {
    const e = new DurationEstimator(15)
    const text = 'x'.repeat(100)
    for (let i = 0; i < 20; i++) e.observe(text, 10) // thực tế 10 ch/s
    expect(e.charsPerSecond).toBeGreaterThan(10)
    expect(e.charsPerSecond).toBeLessThan(11)
  })

  it('bỏ qua quan sát vô lý thay vì để nó phá hệ số', () => {
    const e = new DurationEstimator(15)
    const before = e.charsPerSecond
    e.observe('hello', 0)
    e.observe('', 5)
    e.observe('hello', -3)
    expect(e.charsPerSecond).toBe(before)
  })

  it('không bao giờ trả thời lượng bằng 0', () => {
    const e = new DurationEstimator(15)
    expect(e.estimate('')).toBeGreaterThan(0)
  })

  it('giữ hệ số trong khoảng hợp lý', () => {
    const e = new DurationEstimator(15)
    for (let i = 0; i < 50; i++) e.observe('x'.repeat(100), 0.01)
    expect(e.charsPerSecond).toBeLessThanOrEqual(40)
  })

  it('giữ hệ số không tụt xuống dưới sàn', () => {
    const e = new DurationEstimator(15)
    for (let i = 0; i < 50; i++) e.observe('x'.repeat(10), 100) // thực tế 0.1 ch/s
    expect(e.charsPerSecond).toBe(5)
  })
})
