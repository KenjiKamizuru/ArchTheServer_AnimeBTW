// Tests for the mail message contracts (server/mail.mjs, AV-103/AV-104).
import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationMessage, resetMessage } from '../server/mail.mjs'

const user = { username: 'fern', displayName: 'Fern', email: 'fern@example.com' }

test('verification and reset messages carry the single-use token', () => {
  const verify = verificationMessage(user, 'RAW1')
  assert.equal(verify.to, 'fern@example.com')
  assert.equal(verify.subject, 'Verify your email')
  assert.ok(verify.text.includes('RAW1'), 'the raw token is the user-facing credential')
  assert.ok(verify.text.includes('Fern'))

  const reset = resetMessage(user, 'RAW2')
  assert.equal(reset.to, 'fern@example.com')
  assert.equal(reset.subject, 'Reset your password')
  assert.ok(reset.text.includes('RAW2'))
  assert.ok(reset.text.toLowerCase().includes('ignore'), 'unsolicited resets tell the user to ignore')
  assert.ok(!verify.text.includes('RAW2') && !reset.text.includes('RAW1'), 'tokens never cross messages')
})
