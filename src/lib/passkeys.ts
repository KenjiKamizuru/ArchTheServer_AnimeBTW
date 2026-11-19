// Passkey ceremonies (AV-105c) via navigator.credentials.
//
// The server owns all verification (single-use challenges, origin/rpIdHash,
// ES256 assertion, counter backstop); this module only marshals the browser
// WebAuthn calls. Scope matches the server: ES256 (-7) keys and 'none'
// attestation. The user handle is an opaque random value — credentials are
// looked up by credentialId server-side, not by this handle.

import { api } from './api'

function b64urlToBuf(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out.buffer
}

function bufToB64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

/** Run the registration ceremony and register the resulting credential. */
export async function registerPasskeyCeremony(name: string) {
  const { challenge } = await api.passkeyChallenge('register')
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBuf(challenge),
      rp: { name: 'AnimeVault' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'animevault-user',
        displayName: 'AnimeVault user',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey registration was cancelled')
  const response = credential.response as AuthenticatorAttestationResponse
  return api.passkeyRegister({
    clientDataJSON: bufToB64url(response.clientDataJSON),
    attestationObject: bufToB64url(response.attestationObject),
    name,
  })
}

/** Run the assertion ceremony and sign in. */
export async function signInWithPasskey() {
  const { challenge } = await api.passkeyChallenge('authenticate')
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuf(challenge),
      rpId: window.location.hostname,
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey sign-in was cancelled')
  const response = credential.response as AuthenticatorAssertionResponse
  return api.passkeyAuthenticate({
    credentialId: bufToB64url(credential.rawId),
    clientDataJSON: bufToB64url(response.clientDataJSON),
    authenticatorData: bufToB64url(response.authenticatorData),
    signature: bufToB64url(response.signature),
  })
}
