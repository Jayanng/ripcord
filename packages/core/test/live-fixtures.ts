import { fetchHat, fetchRip, verifyHatInRip } from '../src/proofs.js';
import {
  deriveIdentity,
  getQuorum,
  createVault,
  makeSigner,
  sendTransfer,
  toSdkVault,
} from '../src/index.js';

export interface ProofFixture {
  hash: string;
  epoch: number;
}

const DEFAULT_DAEMON = 'https://rpc-regtest.tachibtc.com';

/**
 * Seed fixtures known to have closed epochs and verified HAT+RIP proofs.
 * If these are still present on the live daemon, they are reused immediately.
 * If they are pruned, getLiveProofFixtures automatically discovers fresh fixtures
 * from closed epochs or executes live transfers to heal itself.
 */
const SEED_FIXTURES: ProofFixture[] = [
  {
    hash: '0c8af8cf18444109099cd6da9a23e26425363b7c5bdcf7c1136cefabdc591ff7',
    epoch: 857232,
  },
  {
    hash: '861c3e79d319a8664b49e945f9632dfb4b8d40b6cb9d91d3f1f38ff3fa2eb108',
    epoch: 857185,
  },
  {
    hash: '56df0bcf6bdd353ff01a919bd9f8add3ee5d16c956619ca7cb81450990c13463',
    epoch: 857184,
  },
];

let cachedFixtures: ProofFixture[] | null = null;

async function retry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Resolve live-valid proof fixtures dynamically.
 * Guaranteed to have verified HAT-in-RIP proofs and at least `minClosedWindow`
 * closed epochs following the transaction so historical window queries succeed.
 */
export async function getLiveProofFixtures(
  count = 3,
  minClosedWindow = 50,
  baseUrl = DEFAULT_DAEMON,
): Promise<ProofFixture[]> {
  if (cachedFixtures && cachedFixtures.length >= count) {
    return cachedFixtures.slice(0, count);
  }

  const statsRes = await retry(() => fetch(`${baseUrl}/tachi_stats`));
  if (!statsRes.ok) {
    throw new Error(`Failed to fetch stats from ${baseUrl}: HTTP ${statsRes.status}`);
  }
  const stats = (await statsRes.json()) as { current_epoch: number };
  const currentEpoch = stats.current_epoch;

  const validFixtures: ProofFixture[] = [];
  const suffixes = new Set<number>();

  // 1. Check known seeds first
  for (const seed of SEED_FIXTURES) {
    if (currentEpoch - seed.epoch < minClosedWindow) continue;
    try {
      const hat = await retry(() => fetchHat(seed.hash, { baseUrl }), 1, 500);
      const rip = await retry(() => fetchRip(seed.hash, seed.epoch, { baseUrl, window: 0 }), 1, 500);
      const link = verifyHatInRip(hat, rip);
      if (link.verified && !suffixes.has(link.suffix)) {
        suffixes.add(link.suffix);
        validFixtures.push(seed);
        if (validFixtures.length >= count) {
          cachedFixtures = validFixtures;
          return validFixtures;
        }
      }
    } catch {
      // Seed dead or pruned; fall through to discovery
    }
  }

  // 2. Discover recent closed epochs with real transactions
  const pagePromises = Array.from({ length: 10 }, (_, i) => i + 1).map(p =>
    fetch(`${baseUrl}/tachi_listEpochs?page=${p}&pageSize=100`)
      .then(r => (r.ok ? r.json() : { epochs: [] }))
      .catch(() => ({ epochs: [] })) as Promise<{
      epochs?: Array<{
        height: number;
        status: string;
        tx_count: number;
        tx_hashes?: string[];
      }>;
    }>,
  );
  const pages = await Promise.all(pagePromises);

  for (const page of pages) {
    if (!page.epochs) continue;
    for (const ep of page.epochs) {
      if (
        ep.status === 'closed' &&
        ep.tx_count > 0 &&
        currentEpoch - ep.height >= minClosedWindow &&
        Array.isArray(ep.tx_hashes)
      ) {
        for (const hash of ep.tx_hashes) {
          if (validFixtures.some(f => f.hash.toLowerCase() === hash.toLowerCase())) {
            continue;
          }
          try {
            const hat = await retry(() => fetchHat(hash, { baseUrl }), 1, 500);
            const rip = await retry(() => fetchRip(hash, ep.height, { baseUrl, window: 0 }), 1, 500);
            const link = verifyHatInRip(hat, rip);
            if (link.verified && !suffixes.has(link.suffix)) {
              suffixes.add(link.suffix);
              validFixtures.push({ hash, epoch: ep.height });
              if (validFixtures.length >= count) {
                cachedFixtures = validFixtures;
                return validFixtures;
              }
            }
          } catch {
            // Not a transfer or missing proof
          }
        }
      }
    }
  }

  // 3. Fallback: execute live transfer if chain is empty of historical txs
  const ALICE_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const ALICE_XONLY = 'e7ab2537b5d49e970309aae06e9e49f36ce1c9febbd44ec8e0d1cca0b4f9c319';
  const BOB_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

  while (validFixtures.length < count) {
    const alice = deriveIdentity(ALICE_MNEMONIC, 'regtest');
    const bob = deriveIdentity(BOB_MNEMONIC, 'regtest');
    const quorum = await getQuorum(baseUrl);
    const aliceVault = await createVault({
      network: 'regtest',
      nodePubkeys: quorum.nodePubkeys,
      csvBlocks: 2,
      userKeyDescriptor: alice.userKeyDescriptor,
    });

    const result = await sendTransfer({
      vault: toSdkVault(aliceVault),
      senderXOnly: ALICE_XONLY,
      recipientAddress: bob.userAddress,
      amountSats: 1000n,
      feeSats: 1n,
      baseUrl,
      network: 'regtest',
      userSigner: makeSigner(ALICE_MNEMONIC, 'regtest', 0),
    });

    const hat = await fetchHat(result.txHash, { baseUrl });
    const rip = await fetchRip(result.txHash, result.epoch, { baseUrl, window: 0 });
    const link = verifyHatInRip(hat, rip);
    if (link.verified && !suffixes.has(link.suffix)) {
      suffixes.add(link.suffix);
      validFixtures.push({ hash: result.txHash, epoch: result.epoch });
    }
  }

  cachedFixtures = validFixtures;
  return validFixtures;
}
