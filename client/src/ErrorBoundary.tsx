import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Melon keeps everything in localStorage, which means a single malformed value
 * — written by an older build, or by a write that was interrupted — can throw
 * during render and unmount the whole tree. React's default for an uncaught
 * render error is a blank white page, which tells the user nothing and offers
 * no way back: no message, no reset, no hint that clearing site data would fix
 * it. This turns that dead end into something a person can act on.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Everything Melon owns. Deliberately narrow — other sites' keys are not ours. */
const MELON_PREFIX = "melon.";

function melonKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(MELON_PREFIX));
  } catch {
    return [];
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the real stack in the console for anyone willing to open devtools.
    console.error("Melon failed to render:", error, info.componentStack);
  }

  /**
   * Copy saved data to the clipboard before it is thrown away. Clearing costs
   * the user their chats, agents and API keys, so offering a copy first turns
   * an irreversible step into a recoverable one.
   */
  private copyData = async (): Promise<void> => {
    const dump: Record<string, string | null> = {};
    for (const key of melonKeys()) dump[key] = localStorage.getItem(key);
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
      alert("Saved data copied to the clipboard. Paste it somewhere safe before clearing.");
    } catch {
      alert("Couldn't reach the clipboard. Open the browser console — the data is printed there.");
      console.log(JSON.stringify(dump, null, 2));
    }
  };

  private clearAndReload = (): void => {
    const keys = melonKeys();
    const ok = confirm(
      `This deletes Melon's ${keys.length} saved item${keys.length === 1 ? "" : "s"} — ` +
        `your chats, agents and API keys — and reloads.\n\n` +
        `Nothing belonging to other sites is touched. This cannot be undone.`
    );
    if (!ok) return;
    try {
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      // Nothing useful left to do; the reload below is still worth attempting.
    }
    location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const keyCount = melonKeys().length;

    return (
      <div className="crash-screen">
        <div className="crash-panel">
          <h1>🍈 Melon couldn't start</h1>
          <p>
            Something went wrong while drawing the page, so Melon stopped rather than showing you a
            half-broken screen.
          </p>
          <p className="crash-cause">
            The usual cause is <strong>damaged saved data</strong> — a chat, agent or preset stored by an
            older version in a shape this version doesn't recognise. Melon is holding{" "}
            {keyCount} saved item{keyCount === 1 ? "" : "s"} right now.
          </p>

          <div className="crash-actions">
            <button className="primary-btn" onClick={() => location.reload()}>
              Try again
            </button>
            <button className="small-btn" onClick={this.copyData} disabled={keyCount === 0}>
              Copy my data first
            </button>
            <button className="stop-btn crash-clear" onClick={this.clearAndReload} disabled={keyCount === 0}>
              Clear saved data and restart
            </button>
          </div>

          <p className="crash-note">
            Reloading is worth trying first — it costs nothing. Clearing is the reliable fix, but it
            removes your chats, agents and API keys, so copy them out first if they matter. Your keys
            live only in this browser, so nothing is recoverable from anywhere else.
          </p>

          <details className="crash-details">
            <summary>Technical detail</summary>
            <pre>{error.message}
{error.stack ?? ""}</pre>
          </details>
        </div>
      </div>
    );
  }
}
