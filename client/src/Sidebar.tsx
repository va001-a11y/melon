import { useMemo, useState } from "react";
import type { Agent, ChatMeta, Preset, ProviderDef } from "./types";
import { ROLES, makeId, nextColor } from "./defaults";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";
import { AgentForm, EMPTY_DRAFT, draftFromAgent } from "./AgentForm";
import type { AgentDraft } from "./AgentForm";

interface Props {
  agents: Agent[];
  setAgents: (fn: (prev: Agent[]) => Agent[]) => void;
  providers: ProviderDef[];
  chats: ChatMeta[];
  currentChatId: string;
  running: boolean;
  onNewChat: () => void;
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  presets: Preset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: Preset) => void;
  onDeletePreset: (id: string) => void;
  groupPersonalities: Record<string, string>;
  setGroupPersonalities: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  globalPersonality: string;
  onGlobalPersonality: (v: string) => void;
  onOpenAnalytics: () => void;
  onOpenMarketplace: () => void;
  onRetryProviders: () => void;
  teamNames: Record<string, string>;
  setTeamNames: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  teamBriefs: Record<string, string>;
  setTeamBriefs: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function Sidebar(props: Props) {
  const {
    agents,
    setAgents,
    providers,
    chats,
    currentChatId,
    running,
    onNewChat,
    onLoadChat,
    onDeleteChat,
    onRenameChat,
    presets,
    onSavePreset,
    onApplyPreset,
    onDeletePreset,
    groupPersonalities,
    setGroupPersonalities,
    globalPersonality,
    onGlobalPersonality,
    onOpenAnalytics,
    onOpenMarketplace,
    onRetryProviders,
    teamNames,
    setTeamNames,
    teamBriefs,
    setTeamBriefs,
  } = props;

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingChat, setRenamingChat] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [chatQuery, setChatQuery] = useState("");

  /**
   * Search titles and message text. Chats live in localStorage, so their
   * contents are read directly — a title-only search is close to useless
   * once you have more than a handful of conversations.
   */
  const visibleChats = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true;
      try {
        return (localStorage.getItem(`melon.chat.${c.id}`) ?? "").toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  }, [chats, chatQuery]);

  const roleGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>();
    for (const a of agents) {
      const list = groups.get(a.role) ?? [];
      list.push(a);
      groups.set(a.role, list);
    }
    return [...groups.entries()];
  }, [agents]);

  /** Agents grouped into pipeline teams, in running order. */
  const teamGroups = useMemo(() => {
    const groups = new Map<number, Agent[]>();
    for (const a of agents) {
      const team = a.team ?? 1;
      const list = groups.get(team) ?? [];
      list.push(a);
      groups.set(team, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [agents]);

  const teamCount = teamGroups.length;
  const isPipeline = teamCount > 1;

  const moveToTeam = (id: string, team: number) =>
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, team } : a)));

  /** Put every agent back in one team, collapsing the pipeline. */
  const mergeTeams = () => {
    setAgents((prev) => prev.map((a) => ({ ...a, team: 1 })));
    setTeamNames(() => ({}));
    setTeamBriefs(() => ({}));
  };

  const openAdd = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, provider: providers[0]?.id ?? "anthropic" });
    setShowForm(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setDraft(draftFromAgent(agent));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const saveAgent = () => {
    if (!draft.model.trim()) return;
    const roleLabel = ROLES.find((r) => r.key === draft.role)?.label ?? draft.role;
    const fields = {
      name: draft.name.trim() || `${roleLabel} (${draft.model.trim()})`,
      provider: draft.provider,
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim(),
      role: draft.role,
      personality: draft.personality.trim(),
      webSearch: draft.webSearch === true,
    };
    if (editingId) {
      setAgents((prev) => prev.map((a) => (a.id === editingId ? { ...a, ...fields } : a)));
    } else {
      setAgents((prev) => [...prev, { id: makeId(), active: true, color: nextColor(prev), ...fields }]);
    }
    closeForm();
  };

  /**
   * Clicking an agent toggles just that agent. It never touches the others,
   * so building any combination is a matter of clicking each one you want.
   */
  const toggleAgent = (id: string) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));
  };

  /** Explicit "just this one" — available from the context menu. */
  const soloAgent = (id: string) => {
    setAgents((prev) => prev.map((a) => ({ ...a, active: a.id === id })));
  };

  const removeAgent = (id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    if (editingId === id) closeForm();
  };

  const duplicateAgent = (agent: Agent) => {
    setAgents((prev) => [
      ...prev,
      { ...agent, id: makeId(), name: `${agent.name} copy`, color: nextColor(prev), active: false },
    ]);
  };

  const toggleGroup = (roleKey: string) => {
    const members = roleGroups.find(([k]) => k === roleKey)?.[1] ?? [];
    const allOn = members.every((a) => a.active);
    setAgents((prev) => prev.map((a) => (a.role === roleKey ? { ...a, active: !allOn } : a)));
  };

  /** Move an agent within the list — order decides who speaks when in relay mode. */
  const moveAgent = (id: string, delta: number) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      const next = idx + delta;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };

  const openAgentMenu = (e: React.MouseEvent, agent: Agent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "✎ Edit properties…", onClick: () => openEdit(agent) },
        { label: agent.active ? "Turn off" : "Turn on", onClick: () => toggleAgent(agent.id) },
        { label: "Use only this one", onClick: () => soloAgent(agent.id) },
        { label: "Move up (speaks earlier)", onClick: () => moveAgent(agent.id, -1) },
        { label: "Move down (speaks later)", onClick: () => moveAgent(agent.id, 1) },
        { label: "Duplicate", onClick: () => duplicateAgent(agent) },
        // Teams turn the line-up into a pipeline: 1 gathers, 2 drafts, 3 simplifies.
        ...[1, 2, 3, 4]
          .filter((t) => t !== (agent.team ?? 1) && t <= teamCount + 1)
          .map((t) => ({
            label: t > teamCount ? `Move to a new Team ${t}` : `Move to ${teamNames[String(t)] || `Team ${t}`}`,
            onClick: () => moveToTeam(agent.id, t),
          })),
        { label: "Remove", onClick: () => removeAgent(agent.id), danger: true },
      ],
    });
  };

  const openChatMenu = (e: React.MouseEvent, chat: ChatMeta) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "✎ Rename…",
          onClick: () => {
            setRenamingChat(chat.id);
            setRenameValue(chat.title);
          },
        },
        { label: "Delete chat", onClick: () => onDeleteChat(chat.id), danger: true },
      ],
    });
  };

  const commitRename = (id: string) => {
    const value = renameValue.trim();
    if (value) onRenameChat(id, value);
    setRenamingChat(null);
  };

  const activeCount = agents.filter((a) => a.active).length;

  return (
    <aside className="sidebar">
      {/* ================= CHATS (top) ================= */}
      <section className="panel panel-chats">
        <div className="panel-head">
          <h2>Chats</h2>
          <button className="small-btn" onClick={onNewChat} disabled={running}>
            + New
          </button>
        </div>
        {/*
          Always present. It was hidden below four chats, then below two, and
          both times it read as a missing feature rather than a tidy sidebar —
          including to the person who asked for it. A permanently visible box
          also advertises what is not otherwise guessable: it searches message
          text, not just titles.
        */}
        <input
          className="chat-search"
          value={chatQuery}
          onChange={(e) => setChatQuery(e.target.value)}
          placeholder="Search chats and messages…"
        />
        <div className="chat-list">
          {chats.length === 0 && <p className="empty-note">Your conversations appear here.</p>}
          {chats.length > 0 && visibleChats.length === 0 && (
            <p className="empty-note">Nothing matches “{chatQuery}”.</p>
          )}
          {visibleChats.map((c) =>
            renamingChat === c.id ? (
              <input
                key={c.id}
                className="rename-input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id);
                  if (e.key === "Escape") setRenamingChat(null);
                }}
              />
            ) : (
              <div
                key={c.id}
                className={`chat-row ${c.id === currentChatId ? "current" : ""}`}
                onContextMenu={(e) => openChatMenu(e, c)}
              >
                <button
                  className="chat-open"
                  onClick={() => onLoadChat(c.id)}
                  onDoubleClick={() => {
                    setRenamingChat(c.id);
                    setRenameValue(c.title);
                  }}
                  disabled={running}
                  title={`${c.title}\nDouble-click to rename · Right-click for options`}
                >
                  {c.title}
                </button>
                {/* Touch has no right-click, so expose the same menu as a button. */}
                <button
                  className="row-menu-btn"
                  aria-label={`Options for ${c.title}`}
                  title="Options"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChatMenu(e, c);
                  }}
                >
                  ⋯
                </button>
              </div>
            )
          )}
        </div>
      </section>

      <div className="panel-spacer" />

      {/* ================= AGENTS (bottom) ================= */}
      <section className="panel panel-agents">
        <div className="panel-head">
          <h2>
            Agents <span className="active-count">{activeCount} on</span>
          </h2>
          <button className="small-btn" onClick={() => (showForm ? closeForm() : openAdd())}>
            {showForm ? "×" : "+ Add"}
          </button>
        </div>

        <div className="sidebar-tools">
          <button
            className="small-btn"
            onClick={onOpenMarketplace}
            title="Ready-made agent presets you can install in one click; also import/export your own"
          >
            Presets
          </button>
          <button className="small-btn" onClick={onOpenAnalytics} title="Usage, latency and model performance">
            Stats
          </button>
        </div>

        {showForm && (
          <AgentForm
            draft={draft}
            setDraft={setDraft}
            providers={providers}
            editingName={editingId ? agents.find((a) => a.id === editingId)?.name ?? null : null}
            onSave={saveAgent}
            onRetryProviders={onRetryProviders}
          />
        )}

        <details className="section">
          <summary>Saved selections &amp; personality</summary>
          <div className="section-body">
            <p className="key-note">Save which agents are currently on, so you can bring the same line-up back later.</p>
            <div className="preset-save">
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Selection name" />
              <button
                className="small-btn"
                disabled={!presetName.trim()}
                onClick={() => {
                  onSavePreset(presetName.trim());
                  setPresetName("");
                }}
              >
                Save
              </button>
            </div>
            {presets.map((p) => (
              <div key={p.id} className="preset-row">
                <button className="chat-open" onClick={() => onApplyPreset(p)}>
                  {p.name} <span className="preset-count">({p.activeIds.length} on)</span>
                </button>
                <button className="small-btn danger" onClick={() => onDeletePreset(p.id)}>
                  ✕
                </button>
              </div>
            ))}
            <label className="stack-label">
              Global personality
              <textarea
                value={globalPersonality}
                onChange={(e) => onGlobalPersonality(e.target.value)}
                placeholder="applies to every agent"
                rows={2}
              />
            </label>
            <p className="key-note">Inheritance: global → role group → individual.</p>
          </div>
        </details>

        <p className="hint-line">
          Click an agent to turn it on or off · Right-click for options
          {isPipeline && " · Teams run in order, each handed the previous team's work"}
        </p>

        {isPipeline && (
          <div className="pipeline-bar">
            <span>
              Pipeline: {teamGroups.map(([t]) => teamNames[String(t)] || `Team ${t}`).join(" → ")}
              <br />
              Teams always run in order — each needs the previous team's work, so they cannot overlap.
            </span>
            <button className="small-btn" onClick={mergeTeams} title="Put every agent back into one team">
              Merge
            </button>
          </div>
        )}

        <div className="agent-scroll">
          {/* With a pipeline, teams are the organising idea; otherwise roles are. */}
          {isPipeline &&
            teamGroups.map(([team, members], index) => (
              <div key={`team-${team}`} className="team-group">
                <div className="team-head">
                  <span className="team-step">{index + 1}</span>
                  <input
                    className="team-name"
                    value={teamNames[String(team)] ?? ""}
                    placeholder={`Team ${team}`}
                    onChange={(e) => setTeamNames((prev) => ({ ...prev, [String(team)]: e.target.value }))}
                  />
                </div>
                <input
                  className="team-brief"
                  value={teamBriefs[String(team)] ?? ""}
                  placeholder={
                    index === 0 ? "what this team should do (e.g. gather sources)" : "what to do with the previous work"
                  }
                  onChange={(e) => setTeamBriefs((prev) => ({ ...prev, [String(team)]: e.target.value }))}
                />
                {members.map((a) => (
                  <div
                    key={a.id}
                    className={`agent-row selectable ${a.active ? "selected" : ""} ${editingId === a.id ? "editing" : ""}`}
                    onClick={() => toggleAgent(a.id)}
                    onContextMenu={(e) => openAgentMenu(e, a)}
                    title={`${a.active ? "On" : "Off"} — click to toggle · Right-click to move team`}
                  >
                    <span className="dot" style={{ background: a.color }} />
                    <div className="agent-info">
                      <span className="agent-name">{a.name}</span>
                      <span className="agent-model">
                        {ROLES.find((r) => r.key === a.role)?.label ?? a.role} · {a.model}
                      </span>
                    </div>
                    {a.active && <span className="active-pip" />}
                    {/* Touch has no right-click, so expose the same menu as a button. */}
                    <button
                      className="row-menu-btn"
                      aria-label={`Options for ${a.name}`}
                      title="Options"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAgentMenu(e, a);
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                ))}
              </div>
            ))}

          {!isPipeline &&
            roleGroups.map(([roleKey, members]) => {
            const roleLabel = ROLES.find((r) => r.key === roleKey)?.label ?? roleKey;
            const allOn = members.every((a) => a.active);
            const groupPersonality = groupPersonalities[roleKey] ?? "";
            return (
              <div key={roleKey} className="role-group">
                <div className="role-head">
                  <span className="role-title">{roleLabel}</span>
                  <span className="role-actions">
                    <button
                      className={`small-btn ${groupPersonality.trim() ? "has-personality" : ""}`}
                      title="Personality for every agent in this role"
                      onClick={() => setEditingGroup(editingGroup === roleKey ? null : roleKey)}
                    >
                      ✎
                    </button>
                    <button className="small-btn" onClick={() => toggleGroup(roleKey)}>
                      {allOn ? "None" : "All"}
                    </button>
                  </span>
                </div>
                {editingGroup === roleKey && (
                  <textarea
                    className="group-personality"
                    value={groupPersonality}
                    onChange={(e) => setGroupPersonalities((prev) => ({ ...prev, [roleKey]: e.target.value }))}
                    placeholder={`Personality for all ${roleLabel} agents`}
                    rows={2}
                  />
                )}
                {members.map((a) => (
                  <div
                    key={a.id}
                    className={`agent-row selectable ${a.active ? "selected" : ""} ${editingId === a.id ? "editing" : ""}`}
                    onClick={() => toggleAgent(a.id)}
                    onContextMenu={(e) => openAgentMenu(e, a)}
                    title={`${a.active ? "On" : "Off"} — click to turn ${a.active ? "off" : "on"} · Right-click for options`}
                  >
                    <span className="dot" style={{ background: a.color }} />
                    <div className="agent-info">
                      <span className="agent-name">{a.name}</span>
                      <span className="agent-model">
                        {providers.find((p) => p.id === a.provider)?.label ?? a.provider} · {a.model}
                      </span>
                    </div>
                    {a.active && <span className="active-pip" />}
                    {/* Touch has no right-click, so expose the same menu as a button. */}
                    <button
                      className="row-menu-btn"
                      aria-label={`Options for ${a.name}`}
                      title="Options"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAgentMenu(e, a);
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                ))}
              </div>
            );
          })}

          {agents.length === 0 && !showForm && (
            <p className="empty-note">No agents yet. Add one, or pick a ready-made team.</p>
          )}
        </div>
      </section>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}
