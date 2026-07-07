// 2D board rendering: three concentric *rectangular* rings of square cells, laid
// out like a board drawn on graph paper. No game logic here — it only visualises
// the BoardState it is given and reports cell clicks.
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BoardState,
  CellMeta,
  Economy,
  MapCandidateInfo,
  PlayerMovedData,
  PlayerState,
} from "../types";

interface Props {
  board: BoardState;
  players: PlayerState[];
  meta: Record<string, CellMeta>;
  // Balance numbers, used to label each ring's Start cell with its pass bonus/XP.
  economy?: Economy;
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  playerColors: Record<string, string>;
  // When a "pick a cell on the map" decision is pending, these are the selectable
  // cells (affordable + unaffordable). Non-candidates are dimmed.
  candidates?: Record<string, MapCandidateInfo> | null;
  // The latest token move — drives the step-by-step walk animation around a ring.
  recentMove?: PlayerMovedData | null;
  // The cell currently under auction — it blinks to draw attention.
  blinkingCellId?: string | null;
}

// Cells are wider than they are tall — that extra width leaves room for full cell
// names / more info later without making the board huge vertically.
const CELL_W = 66;
const CELL_H = 48;
// Extra top/side padding also leaves headroom for the Start markers drawn above
// each ring's first cell.
const MARGIN = 30;

// Outer-ring dimensions (in cells). Concentric rectangles drawn at a fixed cell
// size only nest cleanly when each inner ring is inset by exactly one cell on
// every side — i.e. 2 fewer columns AND 2 fewer rows (so 8 fewer cells) per ring.
// We therefore derive the OUTER ring's size and subtract 2 per level for the rest
// (see the ring loop below). ``ring_sizes`` in the board JSON must follow the same
// rule: each inner ring has 8 fewer cells than the ring around it.
//
// Rows are pinned to the minimum that still leaves the innermost ring a proper
// loop (>= 3 tall), which maximises the width and gives the wide, landscape board.
function outerDims(outerCount: number, numRings: number): { cols: number; rows: number } {
  const sum = Math.round(outerCount / 2) + 2; // cols + rows (from perimeter = 2*(cols+rows)-4)
  const rows = 2 * numRings + 1; // 7 for 3 rings -> innermost ring is 3 cells tall
  const cols = Math.max(rows, sum - rows); // keep it landscape (wide)
  return { cols, rows };
}

// Grid coordinates of each slot walking clockwise from the top-left corner.
function perimeterCoords(cols: number, rows: number): { gx: number; gy: number }[] {
  const out: { gx: number; gy: number }[] = [];
  for (let x = 0; x < cols; x++) out.push({ gx: x, gy: 0 }); // top →
  for (let y = 1; y < rows; y++) out.push({ gx: cols - 1, gy: y }); // right ↓
  for (let x = cols - 2; x >= 0; x--) out.push({ gx: x, gy: rows - 1 }); // bottom ←
  for (let y = rows - 2; y >= 1; y--) out.push({ gx: 0, gy: y }); // left ↑
  return out;
}

interface Seg {
  cellId: string;
  ring: number;
  slot: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  color: string;
  title: string;
  ownerId: string | null;
}

// The "you pass Start" marker drawn above the first cell of every ring: an arrow
// plus the bonus/XP the player collects on each lap of that ring.
interface StartMarker {
  ring: number;
  cx: number;
  top: number;
  bonus: number;
  xp: number;
}


export function Board({
  board,
  players,
  meta,
  economy,
  selectedCellId,
  onSelectCell,
  playerColors,
  candidates,
  recentMove,
  blinkingCellId,
}: Props) {
  const { segments, startMarkers, width, height, cx, cy, outer } = useMemo(() => {
    const numRings = board.rings.length;
    const outer = outerDims(board.rings[0]?.length ?? 4, numRings);
    const width = outer.cols * CELL_W + MARGIN * 2;
    const height = outer.rows * CELL_H + MARGIN * 2;
    const cx = width / 2;
    const cy = height / 2;

    const segs: Seg[] = [];
    const markers: StartMarker[] = [];
    board.rings.forEach((ring, ringIdx) => {
      // Each inner ring is inset one cell on every side -> 2 smaller per dimension.
      const cols = outer.cols - 2 * ringIdx;
      const rows = outer.rows - 2 * ringIdx;
      const coords = perimeterCoords(cols, rows);
      const originX = cx - (cols * CELL_W) / 2;
      const originY = cy - (rows * CELL_H) / 2;
      ring.forEach((cell, slot) => {
        const gc = coords[slot] ?? { gx: 0, gy: 0 };
        const x = originX + gc.gx * CELL_W;
        const y = originY + gc.gy * CELL_H;
        const cellMeta = meta[cell.type];
        segs.push({
          cellId: cell.id,
          ring: ringIdx,
          slot,
          x,
          y,
          cx: x + CELL_W / 2,
          cy: y + CELL_H / 2,
          color: cellMeta?.color ?? "#30363d",
          title: cellMeta?.title ?? cell.type,
          ownerId: cell.owner_id,
        });
        // First cell of each ring = Start: mark it with an arrow + pass bonus/XP.
        if (slot === 0) {
          markers.push({
            ring: ringIdx,
            cx: x + CELL_W / 2,
            top: y,
            bonus: economy?.start_bonus?.[ringIdx] ?? 0,
            xp: economy?.start_experience?.[ringIdx] ?? 0,
          });
        }
      });
    });
    return { segments: segs, startMarkers: markers, width, height, cx, cy, outer };
  }, [board, meta, economy]);

  const byCell = useMemo(() => {
    const m: Record<string, { x: number; y: number }> = {};
    segments.forEach((s) => (m[s.cellId] = { x: s.cx, y: s.cy }));
    return m;
  }, [segments]);

  // ---- token walk animation -------------------------------------------------
  // On a "walk"/"back" move the token hops through each intermediate cell along
  // the ring (like a real board game); "teleport" and ring changes snap instantly.
  // While animating, the moving token is drawn at `animPos` instead of its final
  // slot. `byCell` is read via a ref so the effect only fires on a *new* move
  // (its `seq`), not on every unrelated state update.
  const [animPos, setAnimPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const byCellRef = useRef(byCell);
  byCellRef.current = byCell;
  const ringSizesRef = useRef(board.ring_sizes);
  ringSizesRef.current = board.ring_sizes;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (!recentMove) return;
    const { player_id, from_ring, from_slot, to_ring, to_slot, mode } = recentMove;
    if (mode === "teleport" || from_ring !== to_ring) {
      setAnimPos(null); // snap for hospital/jail/promotion (and any cross-ring)
      return;
    }
    const cells = byCellRef.current;
    const size = ringSizesRef.current[from_ring] ?? 0;
    if (!size) return;
    const path: { x: number; y: number }[] = [];
    const start = cells[`r${from_ring}s${from_slot}`];
    if (start) path.push(start);
    const steps =
      mode === "back" ? (from_slot - to_slot + size) % size : (to_slot - from_slot + size) % size || size;
    for (let k = 1; k <= steps; k++) {
      const slot = mode === "back" ? (from_slot - k + size) % size : (from_slot + k) % size;
      const p = cells[`r${from_ring}s${slot}`];
      if (p) path.push(p);
    }
    if (path.length < 2) {
      setAnimPos(null);
      return;
    }
    const perStep = 95; // ms spent crossing each cell
    const total = perStep * (path.length - 1);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / total);
      const f = t * (path.length - 1);
      const i = Math.min(path.length - 2, Math.floor(f));
      const frac = f - i;
      const a = path[i];
      const b = path[i + 1];
      setAnimPos({ id: player_id, x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setAnimPos(null);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // Only re-run for a genuinely new move (identified by its event index).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentMove?.seq]);

  // Faint graph-paper gridlines behind the cells, aligned to the cell grid.
  const gridLines = useMemo(() => {
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    const right = width - MARGIN;
    const bottom = height - MARGIN;
    for (let i = 0; i <= outer.cols; i++) {
      const x = MARGIN + i * CELL_W;
      lines.push({ key: `v${i}`, x1: x, y1: MARGIN, x2: x, y2: bottom });
    }
    for (let j = 0; j <= outer.rows; j++) {
      const y = MARGIN + j * CELL_H;
      lines.push({ key: `h${j}`, x1: MARGIN, y1: y, x2: right, y2: y });
    }
    return lines;
  }, [width, height, outer]);

  const pickMode = !!candidates;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="board-svg" role="img" aria-label="Игровое поле">
      <g className="grid">
        {gridLines.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>

      {segments.map((s) => {
        const isSelected = s.cellId === selectedCellId;
        const cand = candidates ? candidates[s.cellId] : undefined;
        const isCandidate = !!cand;
        const dimmed = pickMode && !isCandidate;
        const isBlinking = s.cellId === blinkingCellId;
        const isStart = s.slot === 0;
        let stroke = "#0d1117";
        let strokeWidth = 1;
        if (isCandidate) {
          stroke = cand!.affordable ? "#58a6ff" : "#f85149";
          strokeWidth = 3;
        }
        if (isSelected) {
          stroke = "#f0f6fc";
          strokeWidth = 4;
        }
        const startBonus = economy?.start_bonus?.[s.ring] ?? 0;
        const startXp = economy?.start_experience?.[s.ring] ?? 0;
        return (
          <g
            key={s.cellId}
            className={`cell-seg${isBlinking ? " blinking" : ""}`}
            onClick={() => onSelectCell(s.cellId)}
          >
            <rect
              x={s.x}
              y={s.y}
              width={CELL_W}
              height={CELL_H}
              rx={4}
              fill={s.color}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={dimmed ? 0.3 : 0.95}
            />
            {s.ownerId && (
              <circle cx={s.x + 8} cy={s.y + 8} r={4} fill={playerColors[s.ownerId]} stroke="#0d1117" />
            )}
            {isStart ? (
              <>
                {/* Bonus/XP for passing this ring's Start, shown INSIDE the cell
                    above the (lowered) «Старт» label. */}
                <text x={s.cx} y={s.y + 16} className="start-inline" textAnchor="middle">
                  +{startBonus}$ · {startXp}✦
                </text>
                <text
                  x={s.cx}
                  y={s.y + CELL_H - 12}
                  className="cell-label start-title"
                  textAnchor="middle"
                  opacity={dimmed ? 0.5 : 1}
                >
                  {shortTitle(s.title)}
                </text>
              </>
            ) : (
              <text
                x={s.cx}
                y={s.cy}
                className="cell-label"
                textAnchor="middle"
                dominantBaseline="middle"
                opacity={dimmed ? 0.5 : 1}
              >
                {shortTitle(s.title)}
              </text>
            )}
            {isCandidate && cand!.cost > 0 && (
              <text x={s.cx} y={s.y + CELL_H - 5} className="cell-cost" textAnchor="middle">
                {cand!.cost}$
              </text>
            )}
          </g>
        );
      })}

      {/* Player tokens, fanned out when several share a cell. The token that is
          currently walking is drawn at its animated position (no fan offset). */}
      {players.map((p, i) => {
        const animating = animPos?.id === p.id;
        const pos = animating ? animPos! : byCell[`r${p.ring}s${p.position}`];
        if (!pos) return null;
        const offset = animating ? 0 : (i - (players.length - 1) / 2) * 9;
        return (
          <circle
            key={p.id}
            className={animating ? "token moving" : "token"}
            cx={pos.x + offset}
            cy={pos.y + 13}
            r={animating ? 8 : 7}
            fill={playerColors[p.id]}
            stroke={animating ? "#f0f6fc" : "#0d1117"}
            strokeWidth={2}
          >
            <title>{p.name}</title>
          </circle>
        );
      })}

      {/* Start direction arrow above the first cell of each ring (the pass
          bonus/XP is now drawn INSIDE the Start cell itself). */}
      <g className="start-markers">
        {startMarkers.map((m) => (
          <g key={`start-${m.ring}`} className="start-marker">
            <polygon
              points={`${m.cx - 6},${m.top - 11} ${m.cx + 6},${m.top - 11} ${m.cx},${m.top - 2}`}
              className="sm-arrow"
            />
          </g>
        ))}
      </g>

      <text x={cx} y={cy} textAnchor="middle" className="board-center">
        {pickMode ? "выберите клетку" : "3 круга"}
      </text>
    </svg>
  );
}

function shortTitle(title: string): string {
  return title.length > 12 ? title.slice(0, 11) + "…" : title;
}

