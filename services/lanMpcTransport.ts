/**
 * LAN MPC wire encryption — same rules as GG18 (BBMTLib/tss MessengerImp):
 * - Duo: ECIES with peer public key + local private key
 * - Trio: AES with shared session key (sha256 of session id + master host)
 */
export type EciesKeypair = {publicKey: string; privateKey: string};

export type LanMpcTransportKeys = {
  sessionKey: string;
  encKey: string;
  decKey: string;
};

export function parseEciesKeypairJson(jkp: string): EciesKeypair {
  if (typeof jkp !== 'string' || jkp.startsWith('error:')) {
    throw new Error(
      jkp?.startsWith('error:')
        ? jkp.slice('error:'.length)
        : 'Invalid device keypair',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jkp);
  } catch {
    throw new Error('Invalid encryption key response from native module');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as EciesKeypair).publicKey !== 'string' ||
    typeof (parsed as EciesKeypair).privateKey !== 'string'
  ) {
    throw new Error('Could not parse device encryption keys');
  }
  const kp = parsed as EciesKeypair;
  if (!kp.publicKey.trim() || !kp.privateKey.trim()) {
    throw new Error('Device encryption keys are incomplete');
  }
  return {
    publicKey: kp.publicKey.trim(),
    privateKey: kp.privateKey.trim(),
  };
}

export async function resolveLanKeygenTransportKeys(opts: {
  isTrio: boolean;
  keypairJson: string;
  peerPubkey: string;
  sessionID: string;
  masterHost: string;
  sha256: (message: string) => Promise<string>;
}): Promise<LanMpcTransportKeys> {
  const kp = parseEciesKeypairJson(opts.keypairJson);
  if (opts.isTrio) {
    const sessionKey = (
      await opts.sha256([opts.sessionID, opts.masterHost].join(','))
    ).trim();
    if (!sessionKey) {
      throw new Error('Could not derive trio LAN session key');
    }
    return {sessionKey, encKey: '', decKey: ''};
  }
  const encKey = opts.peerPubkey.trim();
  const decKey = kp.privateKey;
  if (!encKey || !decKey) {
    throw new Error(
      'LAN pairing keys missing — complete device pairing (both devices must show matching security codes), then start wallet setup again.',
    );
  }
  return {sessionKey: '', encKey, decKey};
}

/** Duo spend/sign paths (same ECIES material as GG18 duo keygen). */
export function resolveLanKeysignTransportKeys(opts: {
  keypairJson: string;
  peerPubkey: string;
}): LanMpcTransportKeys {
  const kp = parseEciesKeypairJson(opts.keypairJson);
  const encKey = opts.peerPubkey.trim();
  const decKey = kp.privateKey;
  if (!encKey || !decKey) {
    throw new Error(
      'LAN pairing keys missing — pair devices again before co-signing.',
    );
  }
  return {sessionKey: '', encKey, decKey};
}
