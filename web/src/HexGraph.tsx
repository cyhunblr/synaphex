import type { AgentModel, AgentName, EdgeModel } from "./api";

/**
 * The Synaphex hex: the USER at the centre, the six logical agents around it.
 *
 * The layout is deliberately hand-positioned rather than produced by a graph
 * engine. Six nodes at fixed angles need no force simulation, and a custom
 * SVG keeps the shipped bundle small and every element individually
 * focusable.
 *
 * The centre is the USER because the user is the orchestrator: agents do not
 * advance the workflow themselves, so nothing here draws an automatic
 * pipeline between them.
 */

const ORDER: AgentName[] = [
  "questioner",
  "researcher",
  "examiner",
  "planner",
  "coder",
  "reviewer",
];

const SIZE = 640;
const CENTER = SIZE / 2;
const RING = 208;
const HEX_R = 74;

/** Flat-top hexagon points, used for every node so the grid reads as one system. */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

/** Clockwise from the top, matching the documented mental model. */
function position(index: number): { x: number; y: number } {
  const angle = (Math.PI / 180) * (60 * index - 90);
  return {
    x: CENTER + RING * Math.cos(angle),
    y: CENTER + RING * Math.sin(angle),
  };
}

/** Stops an edge short of the node so the arrowhead stays visible. */
function shorten(
  from: { x: number; y: number },
  to: { x: number; y: number },
  by: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / length) * by, y: to.y - (dy / length) * by };
}

export interface HexGraphProps {
  agents: AgentModel[];
  edges: EdgeModel[];
  selected: AgentName | "user" | null;
  onSelect(node: AgentName | "user"): void;
}

export function HexGraph({ agents, edges, selected, onSelect }: HexGraphProps) {
  const byName = new Map(agents.map((agent) => [agent.agent, agent]));
  const focused = selected !== null && selected !== "user" ? selected : null;

  // Only outgoing edges of the focused agent are drawn at full strength.
  // Rendering all thirty at once is noise, not information.
  const visible = focused
    ? edges.filter((edge) => edge.caller === focused || edge.target === focused)
    : edges.filter((edge) => edge.immutable);

  return (
    <div className="graph-wrap">
      <svg
        className="graph"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label="Synaphex agent graph. The user is at the centre; the six agents surround it."
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        <g aria-hidden="true">
          {visible.map((edge) => {
            const from = position(ORDER.indexOf(edge.caller));
            const rawTo = position(ORDER.indexOf(edge.target));
            const to = shorten(from, rawTo, HEX_R + 8);
            const start = shorten(rawTo, from, HEX_R + 8);
            const emphasised = focused !== null && edge.caller === focused;
            return (
              <line
                key={`${edge.caller}-${edge.target}`}
                className="edge"
                x1={start.x}
                y1={start.y}
                x2={to.x}
                y2={to.y}
                data-decision={edge.decision}
                data-immutable={edge.immutable}
                data-emphasis={emphasised}
                data-muted={focused !== null && !emphasised}
                markerEnd="url(#arrow)"
                style={{ color: "currentColor" }}
              />
            );
          })}
        </g>

        {/* Centre: the orchestrator. */}
        <g
          className="hex-node hex-center"
          role="button"
          tabIndex={0}
          aria-label="User. You are the orchestrator. Open global configuration."
          aria-pressed={selected === "user"}
          data-selected={selected === "user"}
          onClick={() => onSelect("user")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect("user");
            }
          }}
        >
          <polygon className="hex-shape" points={hexPoints(CENTER, CENTER, 86)} />
          <text className="hex-title" x={CENTER} y={CENTER - 6}>
            USER
          </text>
          <text className="hex-sub" x={CENTER} y={CENTER + 12}>
            you orchestrate
          </text>
          <text className="hex-sub" x={CENTER} y={CENTER + 26}>
            every step
          </text>
        </g>

        {ORDER.map((name, index) => {
          const { x, y } = position(index);
          const agent = byName.get(name);
          const status = agent?.status ?? "unconfigured";
          const detail =
            agent?.status === "configured"
              ? `${agent.provider ?? ""} · ${agent.model ?? ""}`
              : status;
          return (
            <g
              key={name}
              className="hex-node"
              role="button"
              tabIndex={0}
              data-selected={selected === name}
              data-status={status}
              aria-label={`${name.toUpperCase()}. ${
                agent?.status === "configured"
                  ? `Configured on ${agent.provider} using ${agent.model}. ${
                      agent.executable ? "Executable." : "Not executable."
                    }`
                  : `${status}.`
              } Open configuration.`}
              aria-pressed={selected === name}
              style={{ animationDelay: `${index * 45}ms` }}
              onClick={() => onSelect(name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(name);
                }
              }}
            >
              <polygon className="hex-shape" points={hexPoints(x, y, HEX_R)} />
              <text className="hex-title" x={x} y={y - 8}>
                {name.toUpperCase()}
              </text>
              <text className="hex-sub" x={x} y={y + 9}>
                {agent?.status === "configured" ? agent.provider : status}
              </text>
              {agent?.status === "configured" ? (
                <text className="hex-sub" x={x} y={y + 23}>
                  {truncate(agent.model ?? "", 16)}
                </text>
              ) : null}
              <title>{`${name.toUpperCase()} — ${detail}`}</title>
            </g>
          );
        })}
      </svg>

      {/* Line style, not colour, carries the meaning. */}
      <div className="legend" aria-hidden="true">
        <span>
          <svg width="26" height="8">
            <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          allow (solid)
        </span>
        <span>
          <svg width="26" height="8">
            <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          ask (dashed)
        </span>
        <span>
          <svg width="26" height="8">
            <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1 5" />
          </svg>
          deny (dotted)
        </span>
        <span>
          <svg width="26" height="8">
            <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
          </svg>
          forbidden by role contract
        </span>
      </div>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export { ORDER as AGENT_ORDER };
