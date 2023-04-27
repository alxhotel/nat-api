import type { NatAPI } from './index.js'

export async function upnpNat (): Promise<NatAPI> {
  throw new Error('Not supported in browsers')
}

export async function pmpNat (): Promise<NatAPI> {
  throw new Error('Not supported in browsers')
}
