import { useEffect, useRef, useState } from "react";
import {
  FREE_ATTEMPTS,
  TooManyAttempts,
  VAULT_KEY,
  WrongPassphrase,
  clearAttempts,
  unlock,
  unlockWait,
  vaultSupported,
} from "./vault";
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
/** "0:30", "14:05". */
function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Unlock({ record, onDone }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const supported = vaultSupported();
  /** When the next attempt is allowed, if Melon is making you wait. */
  const [waitUntil, setWaitUntil] = useState(() => {
    const wait = unlockWait();
    return wait > 0 ? Date.now() + wait : 0;
  });
  const [now, setNow] = useState(() => Date.now());
  const waiting = waitUntil > now;

  useEffect(() => input.current?.focus(), []);

  // Tick once a second while waiting, and hand the keyboard back when it ends.
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= waitUntil) {
        window.clearInterval(timer);
        setWaitUntil(0);
        setProblem(null);
        window.setTimeout(() => input.current?.focus(), 0);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  const submit = async () => {
    if (!passphrase || busy || waiting) return;
    setBusy(true);
    setProblem(null);
    try {
      await unlock(passphrase, record);
      onDone();
    } catch (error) {
      setBusy(false);
      setPassphrase("");
      if (error instanceof TooManyAttempts || (error instanceof WrongPassphrase && error.waitMs > 0)) {
        const t = Date.now();
        setNow(t);
        setWaitUntil(t + error.waitMs);
        setProblem(
          `That is more than ${FREE_ATTEMPTS} wrong passphrases, so Melon is making you wait before the next try. ` +
            "Each further wrong one doubles the wait, up to 15 minutes."
        );
        return;
      }
      if (error instanceof WrongPassphrase) {
        const left = error.freeAttemptsLeft;
        setProblem(
          "That passphrase is not right." +
            (left <= 2
              ? ` ${left === 0 ? "The next wrong one" : `After ${left} more wrong ${left === 1 ? "one" : "ones"}, the next`} will make you wait before trying again.`
              : "") +
            " If you have restored a backup or copied Melon's data from elsewhere, it may need the passphrase that was in use there."
        );
      } else {
        setProblem("Melon could not read its locked keys. Your other data is fine.");
      }
      input.current?.focus();
    }
  };

  const forget = () => {
    try {
      localStorage.removeItem(VAULT_KEY);
      clearAttempts();
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
              disabled={busy || waiting}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            {problem && (
              <p className="unlock-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="crash-actions">
              <button className="primary-btn" type="submit" disabled={!passphrase || busy || waiting}>
                {busy ? "Unlocking…" : waiting ? `Try again in ${formatWait(waitUntil - now)}` : "Unlock"}
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
