import { createMultipartUpload, uploadPart, completeMultipartUpload, del } from '@vercel/blob'

const token = process.env.BLOB_READ_WRITE_TOKEN
const pathname = 'mpu-test-' + Date.now() + '.txt'

// 5MB em 2 partes
const part1 = Buffer.alloc(3 * 1024 * 1024, 0x61)
const part2 = Buffer.alloc(2 * 1024 * 1024, 0x62)

console.log('create...')
const created = await createMultipartUpload(pathname, {
  access: 'public',
  contentType: 'text/plain',
})
console.log('created:', JSON.stringify(created))

const parts = []
for (let n = 1; n <= 2; n++) {
  const body = n === 1 ? part1 : part2
  console.log('uploadPart', n, '(' + body.length + ' bytes)...')
  const r = await uploadPart(pathname, body, {
    access: 'public',
    contentType: 'text/plain',
    uploadId: created.uploadId,
    key: created.key,
    partNumber: n,
  })
  console.log('part result:', JSON.stringify(r))
  parts.push(r)
}

console.log('complete...')
const done = await completeMultipartUpload(pathname, parts, {
  access: 'public',
  contentType: 'text/plain',
  uploadId: created.uploadId,
  key: created.key,
})
console.log('complete:', JSON.stringify(done).slice(0, 400))

const res = await fetch(done.url)
const buf = Buffer.from(await res.arrayBuffer())
console.log('fetched:', res.status, 'bytes=' + buf.length, 'p1ok=' + buf.subarray(0, 8).equals(part1.subarray(0, 8)), 'p2ok=' + buf.subarray(buf.length - 8).equals(part2.subarray(part2.length - 8)))

const d = await del(done.url)
console.log('deleted:', d)