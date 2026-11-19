// Mail transport seam (AV-103): the default transport logs to the console —
// self-hosted installations cannot assume SMTP. Real delivery plugs in here
// (e.g. an SMTP transport configured by the installation); verification and
// reset flows only depend on `sendMail`.

export function sendMail(message) {
  const to = String(message?.to ?? '')
  const subject = String(message?.subject ?? '')
  const text = String(message?.text ?? '')
  console.log(`[mail] to=${to} subject=${subject}`)
  console.log(text)
  return { delivered: false, transport: 'console' }
}

export function verificationMessage(user, rawToken) {
  return {
    to: user.email,
    subject: 'Verify your email',
    text: `Hello ${user.displayName || user.username},\n\nConfirm your email by sending this verification token: ${rawToken}\n\nIf you did not create this account, ignore this message.`,
  }
}

export function resetMessage(user, rawToken) {
  return {
    to: user.email,
    subject: 'Reset your password',
    text: `Hello ${user.displayName || user.username},\n\nReset your password by sending this single-use token: ${rawToken}\n\nIf you did not request this, ignore this message — your password is unchanged.`,
  }
}

/** Login notification (AV-120): sent on every password sign-in when the user
 * opted in. No "new device" wording — device fingerprints are not tracked. */
export function loginNotificationMessage(user, { now = Date.now() } = {}) {
  const when = new Date(now).toISOString()
  return {
    to: user.email,
    subject: 'New sign-in to your account',
    text: `Hello ${user.displayName || user.username},\n\nYour account was signed into at ${when}.\n\nIf this was not you, change your password and review your sessions in Settings.`,
  }
}
