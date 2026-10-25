'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType = 'owner' | 'topic' | 'concept' | 'person' | 'course' | 'project' | 'stub';

type GraphNode = {
  id: string;
  title: string;
  type: NodeType;
  tags: string[];
  exists: boolean;
  connections: number;
  content?: string;
};

type GraphLink = { source: string; target: string };

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
  lastCompiled: string;
  stats: { totalPages: number; totalConnections: number };
};

const NODE_COLORS: Record<NodeType, string> = {
  owner:   '#E8B84B',
  topic:   '#7EB8D6',
  concept: '#A78BDA',
  person:  '#7EC99D',
  course:  '#D4A56A',
  project: '#D47B7B',
  stub:    '#B8B4AF',
};

// ── Force simulation (plain JS, no extra deps) ─────────────────────────────

type Vec3 = { x: number; y: number; z: number };

function initPositions(nodes: GraphNode[]): Map<string, Vec3> {
  const pos = new Map<string, Vec3>();
  nodes.forEach((n, i) => {
    if (n.type === 'owner') {
      pos.set(n.id, { x: 0, y: 0, z: 0 });
    } else {
      const phi = Math.acos(1 - 2 * (i / nodes.length));
      const theta = Math.sqrt(nodes.length * Math.PI) * phi;
      const r = 120 + Math.random() * 40;
      pos.set(n.id, {
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
      });
    }
  });
  return pos;
}

function runForceLayout(
  nodes: GraphNode[],
  links: GraphLink[],
  iterations = 80
): Map<string, Vec3> {
  const pos = initPositions(nodes);
  const vel = new Map<string, Vec3>();
  nodes.forEach((n) => vel.set(n.id, { x: 0, y: 0, z: 0 }));

  const K_REPEL = 6000;
  const K_ATTRACT = 0.012;
  const K_CENTER = 0.005;
  const DAMPING = 0.85;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const pa = pos.get(a.id)!, pb = pos.get(b.id)!;
        const dx = pa.x - pb.x, dy = pa.y - pb.y, dz = pa.z - pb.z;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
        const f = K_REPEL / (dist * dist);
        const nx = (dx / dist) * f, ny = (dy / dist) * f, nz = (dz / dist) * f;
        const va = vel.get(a.id)!, vb = vel.get(b.id)!;
        if (a.type !== 'owner') { va.x += nx; va.y += ny; va.z += nz; }
        if (b.type !== 'owner') { vb.x -= nx; vb.y -= ny; vb.z -= nz; }
      }
    }

    // Attraction along edges
    for (const link of links) {
      const pa = pos.get(link.source), pb = pos.get(link.target);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
      const f = K_ATTRACT * dist;
      const nx = (dx / dist) * f, ny = (dy / dist) * f, nz = (dz / dist) * f;
      const va = vel.get(link.source)!, vb = vel.get(link.target)!;
      if (pos.get(link.source)?.x !== 0 || pos.get(link.source)?.y !== 0) {
        va.x += nx; va.y += ny; va.z += nz;
      }
      if (pos.get(link.target)?.x !== 0 || pos.get(link.target)?.y !== 0) {
        vb.x -= nx; vb.y -= ny; vb.z -= nz;
      }
    }

    // Centering force + damping + position update
    for (const n of nodes) {
      if (n.type === 'owner') continue;
      const p = pos.get(n.id)!, v = vel.get(n.id)!;
      v.x = (v.x - p.x * K_CENTER) * DAMPING;
      v.y = (v.y - p.y * K_CENTER) * DAMPING;
      v.z = (v.z - p.z * K_CENTER) * DAMPING;
      p.x += v.x; p.y += v.y; p.z += v.z;
    }
  }

  return pos;
}

// ── Canvas 3D projection ───────────────────────────────────────────────────

function project(
  p: Vec3, cam: { x: number; y: number; z: number; rotX: number; rotY: number },
  w: number, h: number
): { sx: number; sy: number; depth: number } | null {
  // Rotate around Y axis
  const cosY = Math.cos(cam.rotY), sinY = Math.sin(cam.rotY);
  const rx = p.x * cosY - p.z * sinY;
  const ry = p.y;
  const rz = p.x * sinY + p.z * cosY;

  // Rotate around X axis
  const cosX = Math.cos(cam.rotX), sinX = Math.sin(cam.rotX);
  const rx2 = rx;
  const ry2 = ry * cosX - rz * sinX;
  const rz2 = ry * sinX + rz * cosX;

  // Translate by camera distance
  const tz = rz2 + cam.z;
  if (tz <= 0) return null;

  const fov = 500;
  const sx = (rx2 / tz) * fov + w / 2;
  const sy = (ry2 / tz) * fov + h / 2;
  return { sx, sy, depth: tz };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const camRef = useRef({ x: 0, y: 0, z: 350, rotX: -0.15, rotY: 0 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const posRef = useRef<Map<string, Vec3>>(new Map());
  const timeRef = useRef(0);
  const phaseRef = useRef<Map<string, number>>(new Map());

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  // Fetch graph data
  useEffect(() => {
    fetch('/api/wiki/graph')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: GraphData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setFetchError(String(e));
        setLoading(false);
      });
  }, []);

  // Run force layout once data arrives
  useEffect(() => {
    if (!data || !data.nodes || !data.nodes.length) return;
    posRef.current = runForceLayout(data.nodes, data.links, 100);
    // Assign random float phases
    data.nodes.forEach((n) => phaseRef.current.set(n.id, Math.random() * Math.PI * 2));
  }, [data]);

  const nodeRadius = useCallback((n: GraphNode) => {
    if (n.type === 'owner') return 14;
    return Math.min(5 + n.connections * 1.2, 10);
  }, []);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !data.nodes || !data.nodes.length) return;
    const ctx = canvas.getContext('2d')!;
    const localData = data;

    function draw() {
      const w = canvas!.width, h = canvas!.height;
      timeRef.current += 0.008;
      const t = timeRef.current;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = '#F5F0EB';
      ctx.fillRect(0, 0, w, h);

      const cam = camRef.current;
      const positions = posRef.current;

      // Compute animated positions (gentle float)
      const animPos = new Map<string, Vec3>();
      for (const n of localData.nodes) {
        const base = positions.get(n.id) ?? { x: 0, y: 0, z: 0 };
        const phase = phaseRef.current.get(n.id) ?? 0;
        animPos.set(n.id, {
          x: base.x + Math.sin(t * 0.7 + phase) * (n.type === 'owner' ? 0.8 : 2),
          y: base.y + Math.cos(t * 0.5 + phase * 1.3) * (n.type === 'owner' ? 0.5 : 2.5),
          z: base.z + Math.sin(t * 0.6 + phase * 0.7) * 1.5,
        });
      }

      // Project all nodes
      const projected = new Map<string, { sx: number; sy: number; depth: number } | null>();
      for (const n of localData.nodes) {
        const p = animPos.get(n.id)!;
        projected.set(n.id, project(p, cam, w, h));
      }

      // Draw edges (back to front not critical for lines)
      ctx.save();
      for (const link of localData.links) {
        const pa = projected.get(link.source);
        const pb = projected.get(link.target);
        if (!pa || !pb) continue;

        const isHighlighted = search
          ? localData.nodes.find((n) => n.id === link.source || n.id === link.target)
              ?.title.toLowerCase().includes(search.toLowerCase())
          : false;

        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.strokeStyle = isHighlighted
          ? 'rgba(126,184,214,0.7)'
          : 'rgba(126,184,214,0.18)';
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.stroke();
      }
      ctx.restore();

      // Draw nodes back-to-front (sort by depth descending)
      const sortedNodes = [...localData.nodes].sort((a, b) => {
        const da = projected.get(a.id)?.depth ?? 0;
        const db = projected.get(b.id)?.depth ?? 0;
        return db - da;
      });

      for (const n of sortedNodes) {
        const pp = projected.get(n.id);
        if (!pp) continue;

        const isDimmed = search
          ? !n.title.toLowerCase().includes(search.toLowerCase())
          : false;

        const isHovered = hoveredNode?.id === n.id;
        const isSelected = selectedNode?.id === n.id;

        // Scale by depth
        const scale = Math.max(350 / pp.depth, 0.3);
        const r = nodeRadius(n) * scale;

        const color = NODE_COLORS[n.type] ?? NODE_COLORS.stub;
        const alpha = isDimmed ? 0.2 : n.exists ? 1 : 0.5;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Glow for hovered/selected/owner
        if (isHovered || isSelected || n.type === 'owner') {
          const glowR = r + (isSelected ? 8 : 5);
          const gradient = ctx.createRadialGradient(pp.sx, pp.sy, r * 0.3, pp.sx, pp.sy, glowR);
          gradient.addColorStop(0, color + '88');
          gradient.addColorStop(1, color + '00');
          ctx.beginPath();
          ctx.arc(pp.sx, pp.sy, glowR, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // Node sphere (gradient for 3D look)
        const gradient = ctx.createRadialGradient(
          pp.sx - r * 0.3, pp.sy - r * 0.3, r * 0.1,
          pp.sx, pp.sy, r
        );
        gradient.addColorStop(0, lighten(color));
        gradient.addColorStop(0.6, color);
        gradient.addColorStop(1, darken(color));

        ctx.beginPath();
        ctx.arc(pp.sx, pp.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = '#1A1A1A';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Stub nodes: dashed border
        if (!n.exists) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = color + 'AA';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();

        // Label for large nodes or hovered
        if (r > 6 || isHovered || isSelected || n.type === 'owner') {
          ctx.save();
          ctx.globalAlpha = isDimmed ? 0.15 : 1;
          ctx.fillStyle = n.type === 'owner' ? '#1A1A1A' : '#3A3A3A';
          ctx.font = `${n.type === 'owner' ? 600 : 400} ${Math.max(11, r * 0.9)}px "EB Garamond", serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(n.title, pp.sx, pp.sy + r + 4);
          ctx.restore();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [data, search, hoveredNode, selectedNode, nodeRadius, loading]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    return () => ro.disconnect();
  }, []);

  // Mouse handlers
  function hitTest(ex: number, ey: number): GraphNode | null {
    const canvas = canvasRef.current;
    if (!canvas || !data || !data.nodes) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = ex - rect.left, my = ey - rect.top;
    const cam = camRef.current;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;

    let best: GraphNode | null = null;
    let bestDist = Infinity;

    for (const n of data.nodes) {
      const base = posRef.current.get(n.id) ?? { x: 0, y: 0, z: 0 };
      const pp = project(base, cam, w, h);
      if (!pp) continue;
      const scale = Math.max(350 / pp.depth, 0.3);
      const r = nodeRadius(n) * scale;
      const dist = Math.hypot(mx - pp.sx, my - pp.sy);
      if (dist < r + 4 && dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }

  function onMouseMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (d.dragging) {
      const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
      camRef.current.rotY += dx * 0.005;
      camRef.current.rotX += dy * 0.005;
      camRef.current.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camRef.current.rotX));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      setHoveredNode(null);
      setTooltip(null);
    } else {
      const hit = hitTest(e.clientX, e.clientY);
      setHoveredNode(hit);
      if (hit) setTooltip({ x: e.clientX, y: e.clientY });
      else setTooltip(null);
    }
  }

  function onMouseUp(e: React.MouseEvent) {
    const wasDragging = dragRef.current.dragging;
    dragRef.current.dragging = false;
    if (!wasDragging || (Math.abs(e.clientX - dragRef.current.lastX) < 3 && Math.abs(e.clientY - dragRef.current.lastY) < 3)) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) setSelectedNode((prev) => (prev?.id === hit.id ? null : hit));
    }
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    camRef.current.z = Math.max(80, Math.min(800, camRef.current.z + e.deltaY * 0.4));
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, background: '#F5F0EB', color: '#9B9BAB' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid #E8E4DF', borderTopColor: '#7EB8D6',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-jetbrains-mono)' }}>Building graph…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D4645C', fontSize: 14, background: '#F5F0EB' }}>
        {fetchError ?? 'Failed to load graph'}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Stats + search bar */}
      <div style={{
        position: 'absolute', top: 14, left: 14, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <input
          type="text"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #E8E4DF',
            background: '#FFFFFF', fontSize: 12, color: '#1A1A1A',
            fontFamily: 'inherit', outline: 'none', width: 180,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        />
        <span style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', background: 'rgba(245,240,235,0.9)', padding: '4px 8px', borderRadius: 4 }}>
          {data.stats.totalPages} pages · {data.stats.totalConnections} links
        </span>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: hoveredNode ? 'pointer' : 'grab', display: 'block' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragRef.current.dragging = false; setHoveredNode(null); setTooltip(null); }}
        onWheel={onWheel}
      />

      {/* Hover tooltip */}
      {hoveredNode && tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 10,
          background: '#FFFFFF', border: '1px solid #E8E4DF',
          borderRadius: 8, padding: '6px 12px', pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100,
          maxWidth: 220,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{hoveredNode.title}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: NODE_COLORS[hoveredNode.type], flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#6B6B7B', fontFamily: 'var(--font-jetbrains-mono)' }}>
              {hoveredNode.type}{!hoveredNode.exists ? ' · stub' : ''} · {hoveredNode.connections} connections
            </span>
          </div>
        </div>
      )}

      {/* Slide-over panel */}
      {selectedNode && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 380,
          background: '#FFFFFF', borderLeft: '1px solid #E8E4DF',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'slideIn 0.2s ease',
        }}>
          {/* Panel header */}
          <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid #E8E4DF', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: NODE_COLORS[selectedNode.type] }} />
                  <span style={{ fontSize: 11, color: '#6B6B7B', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {selectedNode.type.toUpperCase()}{!selectedNode.exists ? ' · NOT YET WRITTEN' : ''}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1A1A1A' }}>{selectedNode.title}</div>
                <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 4 }}>{selectedNode.connections} connections</div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9B9BAB', padding: 4, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            {selectedNode.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                {selectedNode.tags.map((tag) => (
                  <span key={tag} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#E8F2F8', color: '#5BA3C9', fontFamily: 'var(--font-jetbrains-mono)' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {selectedNode.content ? (
              <div className="md-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedNode.content}</ReactMarkdown>
              </div>
            ) : (
              <div style={{ textAlign: 'center', paddingTop: 40, color: '#9B9BAB' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📝</div>
                <div style={{ fontSize: 14, color: '#6B6B7B' }}>This page hasn&apos;t been written yet.</div>
                <div style={{ fontSize: 12, color: '#9B9BAB', marginTop: 6 }}>It was referenced by another wiki page.</div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Color utilities ───────────────────────────────────────────────────────────

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + 60);
  const g = Math.min(255, ((n >> 8) & 0xff) + 60);
  const b = Math.min(255, (n & 0xff) + 60);
  return `rgb(${r},${g},${b})`;
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 40);
  const g = Math.max(0, ((n >> 8) & 0xff) - 40);
  const b = Math.max(0, (n & 0xff) - 40);
  return `rgb(${r},${g},${b})`;
}
