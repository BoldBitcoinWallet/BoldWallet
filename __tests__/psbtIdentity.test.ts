import {
  canonicalPsbtBase64,
  isPsbtBytes,
  isValidLanPsbtSessionPayload,
  lanPsbtSessionPayloadMatchesHash,
  parsePsbtSessionPayload,
  readPsbtBase64FromFile,
} from '../services/psbtIdentity';

// Minimal valid PSBT header: psbt\xff + empty global map (0x00)
const PSBT_BYTES = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff, 0x00]);
const CANONICAL = PSBT_BYTES.toString('base64');
const NO_PADDING = CANONICAL.replace(/[=]+$/, '');

describe('psbtIdentity', () => {
  it('detects psbt magic bytes', () => {
    expect(isPsbtBytes(PSBT_BYTES)).toBe(true);
    expect(isPsbtBytes(Buffer.from('hello'))).toBe(false);
  });

  it('canonicalPsbtBase64 normalizes padding and whitespace', () => {
    expect(canonicalPsbtBase64(NO_PADDING)).toBe(CANONICAL);
    expect(canonicalPsbtBase64(`  ${NO_PADDING}\n`)).toBe(CANONICAL);
  });

  it('isValidLanPsbtSessionPayload rejects incomplete or stale payloads', () => {
    const seed = 'a'.repeat(64);
    const hash = 'b'.repeat(64);
    expect(isValidLanPsbtSessionPayload(`${seed}:${hash}:npub1abc`)).toBe(
      true,
    );
    expect(isValidLanPsbtSessionPayload(seed)).toBe(false);
    expect(isValidLanPsbtSessionPayload(`${seed}:short:npub`)).toBe(false);
    expect(
      isValidLanPsbtSessionPayload('192.168.0.1@id@pub,192.168.0.2@id@pub'),
    ).toBe(false);
  });

  it('lanPsbtSessionPayloadMatchesHash requires matching psbt hash', () => {
    const seed = 'a'.repeat(64);
    const hash = 'b'.repeat(64);
    const payload = `${seed}:${hash}:npub1abc`;
    expect(lanPsbtSessionPayloadMatchesHash(payload, hash)).toBe(true);
    expect(lanPsbtSessionPayloadMatchesHash(payload, 'c'.repeat(64))).toBe(
      false,
    );
    expect(lanPsbtSessionPayloadMatchesHash('not-a-session', hash)).toBe(
      false,
    );
  });

  it('parsePsbtSessionPayload supports party keys with colons', () => {
    const seed = 'a'.repeat(64);
    const hash = 'b'.repeat(64);
    const party = 'npub:extra:segment';
    const payload = `${seed}:${hash}:${party}`;
    expect(parsePsbtSessionPayload(payload)).toEqual({
      psbtHash: hash,
      peerShare: party,
    });
  });

  it('readPsbtBase64FromFile handles binary and text PSBT files', async () => {
    const binaryPath = '/tmp/binary.psbt';
    const textPath = '/tmp/text.psbt';
    const textAsciiBase64 = Buffer.from(NO_PADDING, 'utf8').toString('base64');
    const files: Record<string, {base64?: string; utf8?: string}> = {
      [binaryPath]: {base64: CANONICAL},
      [textPath]: {base64: textAsciiBase64, utf8: NO_PADDING},
    };
    const readFile = async (path: string, enc: 'base64' | 'utf8') => {
      const entry = files[path];
      const value = enc === 'base64' ? entry?.base64 : entry?.utf8;
      if (value === undefined) {
        throw new Error(`missing ${enc} for ${path}`);
      }
      return value;
    };

    expect(await readPsbtBase64FromFile(readFile, binaryPath)).toBe(CANONICAL);
    expect(await readPsbtBase64FromFile(readFile, textPath)).toBe(CANONICAL);
  });
});
