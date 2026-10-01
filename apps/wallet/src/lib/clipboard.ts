/**
 * Clipboard hygiene (Bounty #1, Phase 4): copied addresses clear themselves
 * after 60 seconds so a shared clipboard does not keep leaking them.
 */

const CLEAR_DELAY_MS = 60_000;

export async function copyAddressAndAutoClear(
  address: string,
  onCleared?: () => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    return;
  }
  window.setTimeout(async () => {
    try {
      // Only clear if the clipboard still holds what we put there.
      const current = await navigator.clipboard.readText();
      if (current === address) {
        await navigator.clipboard.writeText('');
        onCleared?.();
      }
    } catch {
      // Clipboard read-back is not permitted everywhere; nothing to do.
    }
  }, CLEAR_DELAY_MS);
}
