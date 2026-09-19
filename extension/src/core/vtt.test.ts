import { describe, expect, it } from 'vitest'
import { parseVtt } from './vtt'

describe('parseVtt', () => {
  it('đọc được cue cơ bản', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello and welcome
`
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 3.5, text: 'Hello and welcome' }])
  })

  it('bỏ qua id của cue', () => {
    const vtt = `WEBVTT

42
00:00:05.000 --> 00:00:06.000
Second cue
`
    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 6, text: 'Second cue' }])
  })

  it('gộp nhiều dòng text thành một chuỗi', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
first line
second line
`
    expect(parseVtt(vtt)[0].text).toBe('first line second line')
  })

  it('đọc được timestamp có giờ', () => {
    const vtt = `WEBVTT

01:02:03.250 --> 01:02:04.000
Late cue
`
    expect(parseVtt(vtt)[0].start).toBeCloseTo(3723.25)
  })

  it('bỏ thẻ định dạng trong text', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<v Speaker>a <b>bold</b> word
`
    expect(parseVtt(vtt)[0].text).toBe('a bold word')
  })

  it('bỏ qua cue không có text', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000

00:00:01.000 --> 00:00:02.000
real text
`
    expect(parseVtt(vtt)).toHaveLength(1)
  })

  it('trả mảng rỗng cho chuỗi rỗng', () => {
    expect(parseVtt('')).toEqual([])
  })
})
