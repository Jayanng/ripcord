import { describe, it, expect, beforeAll } from 'vitest';
import {
  deriveIdentity,
  makeSigner,
  getQuorum,
  createVault,
  registerVault,
} from '../src/index.js';
import { RipcordError } from '../src/errors.js';

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DAEMON_URL = 'https://rpc-regtest.tachibtc.com';

describe('register.ts', { timeout: 60000 }, () => {
  let aliceIdentity: Awaited<ReturnType<typeof deriveIdentity>>;
  let quorum: Awaited<ReturnType<typeof getQuorum>>;
  let vault: Awaited<ReturnType<typeof createVault>>;
  let userSigner: ReturnType<typeof makeSigner>;

  beforeAll(async () => {
    aliceIdentity = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    quorum = await getQuorum(DAEMON_URL);
    vault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: aliceIdentity.userKeyDescriptor,
    });
    userSigner = makeSigner(ALICE_MNEMONIC, 'regtest', 0);
  });

  it('derives Alice identity and creates csv=2 vault matching verified fixture', () => {
    expect(aliceIdentity.xOnly).toBe(
      'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319'
    );
    expect(vault.address).toBe(
      'bcrt1pmph2qqzxwk3a52x2ek2yj2k9qydm5kq9x795gxmpuumk2u3vcqnsjgfaqg'
    );
    expect(vault.csvBlocks).toBe(2);
  });

  it('calls registerVault and catches mapped daemon error without live funds', async () => {
    const dummyTxid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const dummyVtxoId = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const xOnlyBuf = Buffer.from(aliceIdentity.xOnly, 'hex');

    await expect(
      registerVault({
        vault: {
          ...vault,
          userKey: {
            compressedHex: aliceIdentity.userKeyDescriptor.publicKey,
            xOnly: xOnlyBuf,
          },
        },
        fundingTxid: dummyTxid,
        fundingVout: 0,
        userSigner,
        vtxoId: dummyVtxoId,
        owner: xOnlyBuf,
        amount: 39999n,
        baseUrl: DAEMON_URL,
      })
    ).rejects.toThrow(RipcordError);
  });

  const hasLiveFunds =
    process.env.RIPCORD_LIVE === '1' &&
    Boolean(process.env.LIVE_FUNDING_TXID && process.env.LIVE_VTXO_ID);

  it.skipIf(!hasLiveFunds)(
    'registers vault on live daemon when live funds are provided',
    async () => {
      const fundingTxid = process.env.LIVE_FUNDING_TXID!;
      const vtxoId = process.env.LIVE_VTXO_ID!;
      const xOnlyBuf = Buffer.from(aliceIdentity.xOnly, 'hex');

      const result = await registerVault({
        vault: {
          ...vault,
          userKey: {
            compressedHex: aliceIdentity.userKeyDescriptor.publicKey,
            xOnly: xOnlyBuf,
          },
        },
        fundingTxid,
        fundingVout: 0,
        userSigner,
        vtxoId,
        owner: xOnlyBuf,
        amount: 39999n,
        baseUrl: DAEMON_URL,
      });

      expect(result.vaultId).toBeDefined();
      expect(typeof result.vaultId).toBe('string');
      expect(result.vaultId.length).toBe(64);
    }
  );
});
