import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Network Globe Background
// Generates a wireframe globe with network connections, rendered as SVG.

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface GlobeNode { x: number; y: number; z: number; sx: number; sy: number; r: number; opacity: number }
interface GlobeEdge { i: number; j: number; opacity: number }
interface SignalPair { fromX: number; fromY: number; toX: number; toY: number; delay: number; duration: number; depth: number }

function generateGlobe() {
  const rng = seededRandom(42);
  const cx = 800, cy = 450, radius = 340;
  const nodes: GlobeNode[] = [];
  const edges: GlobeEdge[] = [];

  const numPoints = 120;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < numPoints; i++) {
    const y = 1 - (i / (numPoints - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const px = Math.cos(theta) * radiusAtY;
    const py = y;
    const pz = Math.sin(theta) * radiusAtY;
    const depthFactor = (pz + 1) / 2;
    if (depthFactor < 0.15) continue;
    const sx = cx + px * radius;
    const sy = cy - py * radius;
    const r = 1 + depthFactor * 2;
    const opacity = 0.08 + depthFactor * 0.25;
    nodes.push({ x: px, y: py, z: pz, sx, sy, r, opacity });
  }

  const latLines: string[] = [];
  for (let li = 1; li < 7; li++) {
    const lat = -1 + (2 * li) / 7;
    const rAtLat = Math.sqrt(1 - lat * lat);
    const points: { sx: number; sy: number }[] = [];
    for (let a = 0; a <= 360; a += 4) {
      const theta = (a * Math.PI) / 180;
      const px = Math.cos(theta) * rAtLat;
      const pz = Math.sin(theta) * rAtLat;
      if ((pz + 1) / 2 < 0.1) continue;
      points.push({ sx: cx + px * radius, sy: cy - lat * radius });
    }
    if (points.length > 2) {
      latLines.push(points.map((p, idx) =>
        (idx === 0 ? 'M' : 'L') + p.sx.toFixed(1) + ',' + p.sy.toFixed(1)
      ).join(' '));
    }
  }

  const lonLines: string[] = [];
  for (let li = 0; li < 12; li++) {
    const theta = (li * Math.PI) / 12;
    const points: { sx: number; sy: number }[] = [];
    for (let a = 0; a <= 360; a += 4) {
      const phi = (a * Math.PI) / 180;
      const px = Math.sin(phi) * Math.cos(theta);
      const py = Math.cos(phi);
      const pz = Math.sin(phi) * Math.sin(theta);
      if ((pz + 1) / 2 < 0.1) continue;
      points.push({ sx: cx + px * radius, sy: cy - py * radius });
    }
    if (points.length > 2) {
      lonLines.push(points.map((p, idx) =>
        (idx === 0 ? 'M' : 'L') + p.sx.toFixed(1) + ',' + p.sy.toFixed(1)
      ).join(' '));
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dz = nodes[i].z - nodes[j].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.45 && rng() > 0.35) {
        const avgDepth = ((nodes[i].z + nodes[j].z) / 2 + 1) / 2;
        edges.push({ i, j, opacity: 0.04 + avgDepth * 0.12 });
      }
    }
  }

  for (let k = 0; k < 8; k++) {
    const i = Math.floor(rng() * nodes.length);
    let j = Math.floor(rng() * nodes.length);
    if (i === j) j = (j + 1) % nodes.length;
    const avgDepth = ((nodes[i].z + nodes[j].z) / 2 + 1) / 2;
    edges.push({ i, j, opacity: 0.06 + avgDepth * 0.08 });
  }

  // Pick signal pairs spread across the whole sphere (front, mid, back)
  const signalPairs: SignalPair[] = [];
  const usedNodes = new Set<number>();
  const enrichedEdges = edges
    .map(e => {
      const avgZ = (nodes[e.i].z + nodes[e.j].z) / 2;
      const depth = (avgZ + 1) / 2; // 0 = far back, 1 = front
      const dx = nodes[e.i].sx - nodes[e.j].sx;
      const dy = nodes[e.i].sy - nodes[e.j].sy;
      const screenDist = Math.sqrt(dx * dx + dy * dy);
      return { ...e, avgZ, depth, screenDist };
    })
    .filter(e => e.screenDist > 30 && e.screenDist < 300);

  // Divide into depth zones: 2 back, 2 mid, 4 front = 8 pairs max
  const zones = [
    { min: 0.0, max: 0.40, max_pick: 2 },
    { min: 0.40, max: 0.65, max_pick: 2 },
    { min: 0.65, max: 1.0, max_pick: 4 },
  ];
  let pairIdx = 0;
  for (const zone of zones) {
    const zoneEdges = enrichedEdges
      .filter(e => e.depth >= zone.min && e.depth < zone.max)
      .sort(() => rng() - 0.5);
    let picked = 0;
    for (const edge of zoneEdges) {
      if (picked >= zone.max_pick) break;
      if (usedNodes.has(edge.i) || usedNodes.has(edge.j)) continue;
      usedNodes.add(edge.i);
      usedNodes.add(edge.j);
      signalPairs.push({
        fromX: nodes[edge.i].sx,
        fromY: nodes[edge.i].sy,
        toX: nodes[edge.j].sx,
        toY: nodes[edge.j].sy,
        delay: pairIdx * 2.5,
        duration: 1.2 + rng() * 0.7,
        depth: edge.depth,
      });
      picked++;
      pairIdx++;
    }
  }

  return { nodes, edges, latLines, lonLines, signalPairs };
}

function NetworkGlobeBackground() {
  const globe = useMemo(() => generateGlobe(), []);
  const { nodes, edges, latLines, lonLines, signalPairs } = globe;

  // JS-driven animation: single clock for all signals
  const [tick, setTick] = useState(0);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  const animate = useCallback((now: number) => {
    if (!startRef.current) startRef.current = now;
    setTick(now - startRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  // Compute signal states from single clock
  const signalStates = signalPairs.map(sig => {
    const tc = sig.duration * 3.5 * 1000; // ms
    const delayMs = sig.delay * 1000;
    const elapsed = tick - delayMs;
    if (elapsed < 0) return { fwd: null, ret: null, pulseDest: 0, pulseOrig: 0 };

    const phase = (elapsed % tc) / tc; // 0..1 within cycle
    const d = sig.depth;

    // Forward dot: travels 0%-25%
    let fwd = null;
    if (phase < 0.25) {
      const t = phase / 0.25; // 0..1 along path
      fwd = {
        x: sig.fromX + (sig.toX - sig.fromX) * t,
        y: sig.fromY + (sig.toY - sig.fromY) * t,
        opacity: 0.3 + d * 0.65,
        r: 1.5 + d * 2.5,
      };
    }

    // Return dot: travels 50%-75%
    let ret = null;
    if (phase >= 0.50 && phase < 0.75) {
      const t = (phase - 0.50) / 0.25;
      ret = {
        x: sig.toX + (sig.fromX - sig.toX) * t,
        y: sig.toY + (sig.fromY - sig.toY) * t,
        opacity: 0.3 + d * 0.65,
        r: 1.5 + d * 2.5,
      };
    }

    // Arrival pulse at destination: fires at 25%, fades by 33%
    let pulseDest = 0;
    if (phase >= 0.25 && phase < 0.33) {
      pulseDest = (phase - 0.25) / 0.08; // 0..1
    }

    // Arrival pulse at origin: fires at 75%, fades by 83%
    let pulseOrig = 0;
    if (phase >= 0.75 && phase < 0.83) {
      pulseOrig = (phase - 0.75) / 0.08; // 0..1
    }

    return { fwd, ret, pulseDest, pulseOrig };
  });

  return (
    <div className="login-globe" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="globe-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="70%" stopColor="rgba(255,255,255,0.01)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <filter id="signal-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="800" cy="450" r="360" fill="url(#globe-glow)" />
        <circle cx="800" cy="450" r="340" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" />

        {latLines.map((d, i) => (
          <path key={'lat-' + i} d={d} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        ))}
        {lonLines.map((d, i) => (
          <path key={'lon-' + i} d={d} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        ))}
        {edges.map((e, i) => (
          <line
            key={'e-' + i}
            x1={nodes[e.i].sx} y1={nodes[e.i].sy}
            x2={nodes[e.j].sx} y2={nodes[e.j].sy}
            stroke={'rgba(255,255,255,' + e.opacity + ')'}
            strokeWidth="0.6"
          />
        ))}
        {nodes.map((n, i) => (
          <circle
            key={'n-' + i}
            cx={n.sx} cy={n.sy} r={n.r}
            fill={'rgba(255,255,255,' + n.opacity + ')'}
          />
        ))}

        {/* JS-driven signals — single clock, perfect sync */}
        {signalPairs.map((sig, i) => {
          const st = signalStates[i];
          const d = sig.depth;
          const maxR = 5 + d * 12;
          const pw = 0.5 + d * 1.2;
          const peakOp = 0.15 + d * 0.5;
          return (
            <g key={'sig-' + i}>
              {st.fwd && (
                <circle
                  cx={st.fwd.x} cy={st.fwd.y} r={st.fwd.r}
                  fill="#69D4AE"
                  opacity={st.fwd.opacity}
                  filter="url(#signal-glow)"
                />
              )}
              {st.ret && (
                <circle
                  cx={st.ret.x} cy={st.ret.y} r={st.ret.r}
                  fill="#69D4AE"
                  opacity={st.ret.opacity}
                  filter="url(#signal-glow)"
                />
              )}
              {st.pulseDest > 0 && (
                <circle
                  cx={sig.toX} cy={sig.toY}
                  r={maxR * st.pulseDest}
                  fill="none" stroke="#69D4AE"
                  strokeWidth={pw}
                  opacity={peakOp * (1 - st.pulseDest)}
                />
              )}
              {st.pulseOrig > 0 && (
                <circle
                  cx={sig.fromX} cy={sig.fromY}
                  r={maxR * st.pulseOrig}
                  fill="none" stroke="#69D4AE"
                  strokeWidth={pw}
                  opacity={peakOp * (1 - st.pulseOrig)}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
      setPassword('');
    }
  };

  return (
    <div className="login-page">
      <NetworkGlobeBackground />

      <div className="login-bg-watermark" aria-hidden="true">
        <img
          src="/advisense_white.png"
          alt=""
          className="login-bg-logo"
        />
        <span className="login-bg-text">Network Orchestration Platform</span>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        {error && <div className="login-error">{error}</div>}

        <div className="form-group">
          <label>Email</label>
          <input
            className="form-control"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your.name@advisense.com"
            required
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            className="form-control"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
