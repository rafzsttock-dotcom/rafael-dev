const { isZip } = await import('../src/handlers/upload.js')

test('isZip mengenali magic bytes ZIP', () => {
  expect(isZip(Buffer.from('504b030414000000', 'hex'))).toBe(true)
})
test('isZip menolak file lain / kosong', () => {
  expect(isZip(Buffer.from('hello world'))).toBe(false)
  expect(isZip(Buffer.alloc(0))).toBe(false)
})
