import { useEffect, useRef, useState } from "react";
import { VAULT_KEY, WrongPassphrase, unlock, vaultSupported } from "./vault";
import type { VaultRecord } from "./vault";

interface Props {
  record: VaultRecord;
  /** Called once the keys are unlocked, or deliberately given up. */
  onDone: () => void;
}

/**
 * Shown before Melon starts whenever the passphrase lock is on. Melon itself
 * does not render until this is done, so nothing can run on missing keys.
 */
export function Unlock({ record, onDone }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const supported = vaultSupported();

  useEffect(() => input.current?.focus(), []);

  const submit = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await unlock(passphrase, record);
      onDone();
    } catch (error) {
      setBusy(false);
      setProblem(
        error instanceof WrongPassphrase
          ? "That passphrase is not right. If you have restored a backup or copied Melon's data from elsewhere, it may need the passphrase that was in use there."
          : "Melon could not read its locked keys. Your other data is fine."
      );
      setPassphrase("");
      input.current?.focus();
    }
  };

  const forget = () => {
    try {
      localStorage.removeItem(VAULT_KEY);
    } catch {
      // Storage blocked: there is nothing to remove that this page can reach.
    }
    onDone();
  };

  return (
    <div className="crash-screen">
      <form
        className="crash-panel unlock-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>🍈 Melon is locked</h1>
        {supported ? (
          <>
            <p>Your API keys are encrypted. Enter your passphrase to use them.</p>
            <input
              ref={input}
              className="unlock-input"
              type="password"
              autoComplete="current-password"
              aria-label="Passphrase"
              placeholder="Passphrase"
              value={passphrase}
              disabled={busy}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            {problem && (
              <p className="unlock-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="crash-actions">
              <button className="primary-btn" type="submit" disabled={!passphrase || busy}>
                {busy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </>
        ) : (
          <p>
            Your API keys are encrypted, and this browser only allows the decryption Melon needs on
            HTTPS or on localhost. Open Melon at the address you locked it from.
          </p>
        )}

        {!forgetting ? (
          <p className="crash-note">
            Forgotten it?{" "}
            <button type="button" className="link-btn" onClick={() => setForgetting(true)}>
              Open Melon without my keys
            </button>
          </p>
        ) : (
          <div className="crash-note">
            <p>
              <strong>Your keys cannot be recovered without the passphrase.</strong> Melon will open with
              all your chats, agents and settings, and every API key empty — paste them in again from each
              provider's website. The lock is turned off; you can turn it on again in Settings.
            </p>
            <div className="crash-actions">
              <button type="button" className="stop-btn crash-clear" onClick={forget}>
                Delete my locked keys and open Melon
              </button>
              <button type="button" className="small-btn" onClick={() => setForgetting(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
