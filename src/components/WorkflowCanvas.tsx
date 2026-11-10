import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowDocument, WorkflowNode } from '../../shared/types/workflowEditor';

export function WorkflowCanvas({ document, selected, disabled, connecting, onSelect, onDeselect, onConfigure, onDuplicate, onDelete, onConnect, onMove }: {
  document: WorkflowDocument; selected: string; disabled: boolean;
  connecting: boolean; onDeselect: () => void;
  onConfigure: (id: string) => void; onDuplicate: (id: string) => void;
  onDelete: (id: string) => void; onConnect: (id: string) => void;
  onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void;
}) {
  const marker = useId().replace(/:/g, '');
  const viewport = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nodeTrigger = useRef<SVGGElement | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const suppressClick = useRef(false);
  const topologyLocked = !!document.runtimeReference;
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const colors = { agent: '#818cf8', hook: '#fbbf24', approval: '#34d399', host: '#38bdf8' };
  useEffect(() => {
    if (menu && selected === menu.id) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menu, selected]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const openMenu = (id: string, trigger: SVGGElement) => {
    onSelect(id);
    if (connecting) return;
    nodeTrigger.current = trigger;
    const bounds = trigger.getBoundingClientRect();
    const canvas = viewport.current?.getBoundingClientRect();
    if (canvas) setMenu({ id, x: Math.max(8, Math.min(canvas.width - 236, bounds.right - canvas.left + 8)),
      y: Math.max(64, Math.min(canvas.height - 230, bounds.top - canvas.top)) });
  };
  const menuAction = (action: (id: string) => void) => {
    if (!menu) return;
    setMenu(null);
    nodeTrigger.current?.focus();
    action(menu.id);
  };
  const move = (node: WorkflowNode, x: number, y: number) => onMove(node.id,
    Math.max(0, Math.min(2900, x)), Math.max(0, Math.min(1900, y)));
  const changeZoom = (value: number) => setZoom(Math.max(.25, Math.min(1.5, Math.round(value * 100) / 100)));
  const fit = () => {
    const element = viewport.current;
    if (!element || !document.nodes.length) return;
    const left = Math.max(0, Math.min(...document.nodes.map((node) => node.x)) - 40);
    const top = Math.max(0, Math.min(...document.nodes.map((node) => node.y)) - 40);
    const width = Math.max(...document.nodes.map((node) => node.x + 260)) - left;
    const height = Math.max(...document.nodes.map((node) => node.y + 124)) - top;
    const padding = getComputedStyle(element);
    const scale = Math.max(.25, Math.min(1.5, (element.clientWidth - parseFloat(padding.paddingLeft) - 24) / width,
      (element.clientHeight - parseFloat(padding.paddingTop) - 80) / height));
    setZoom(scale);
    requestAnimationFrame(() => { element.scrollLeft = left * scale; element.scrollTop = top * scale; });
  };
  return <div className="workflow-canvas">
    <div ref={viewport} className="workflow-canvas-viewport" aria-label="Canvas viewport" onScroll={() => setMenu(null)}>
    <svg width={3200 * zoom} height={2100 * zoom} viewBox="0 0 3200 2100" aria-label="Workflow graph" role="group"
      style={{ touchAction: 'none', cursor: 'grab' }}
      onPointerDown={(event) => {
        const element = viewport.current;
        if (!element || event.button !== 0) return;
        setMenu(null);
        gesture.current = { x: event.clientX, y: event.clientY, moved: false };
        suppressClick.current = false;
        pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pan.current && !drag.current) return;
        if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 4) gesture.current.moved = true;
        if (!gesture.current.moved) return;
        if (pan.current && viewport.current) {
          viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
          viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
          return;
        }
        if (!drag.current || disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const node = document.nodes.find((item) => item.id === drag.current?.id);
        if (node) move(node, (event.clientX - bounds.left) / zoom - drag.current.dx, (event.clientY - bounds.top) / zoom - drag.current.dy);
      }}
      onPointerUp={() => { suppressClick.current = gesture.current.moved; drag.current = null; pan.current = null; }}
      onPointerCancel={() => { suppressClick.current = true; drag.current = null; pan.current = null; }}
      onClick={() => { if (!suppressClick.current) { setMenu(null); onDeselect(); } }}>
      <defs>
        <linearGradient id={`${marker}-node`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#182b44" /><stop offset="100%" stopColor="#0b1425" />
        </linearGradient>
        <filter id={`${marker}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <pattern id={`${marker}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".8" fill="#39556c" />
        </pattern>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#67d9ec" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${marker}-grid)`} />
      {document.edges.map((edge) => {
        const from = document.nodes.find((node) => node.id === edge.from);
        const to = document.nodes.find((node) => node.id === edge.to);
        if (!from || !to) return null;
        const returning = to.x <= from.x;
        const path = returning
          ? `M ${from.x + 110} ${from.y + 84} C ${from.x + 110} ${Math.max(from.y, to.y) + 145}, ${to.x + 110} ${Math.max(from.y, to.y) + 145}, ${to.x + 110} ${to.y + 84}`
          : `M ${from.x + 220} ${from.y + 42} C ${from.x + 275} ${from.y + 42}, ${to.x - 55} ${to.y + 42}, ${to.x} ${to.y + 42}`;
        return <g key={`${edge.from}:${edge.to}`} pointerEvents="none">
          <path d={path} fill="none" stroke="#22d3ee" strokeWidth="5" opacity=".2" filter={`url(#${marker}-glow)`} />
          <path d={path} fill="none" stroke="#67d9ec" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray={returning ? '5 4' : undefined} markerEnd={`url(#${marker})`} />
          {edge.label && <text x={(from.x + to.x + 220) / 2}
            y={returning ? Math.max(from.y, to.y) + 125 : (from.y + to.y) / 2 + 30}
            textAnchor="middle" fill="#b5d5e8" fontSize="10" stroke="#070e1b" strokeWidth="4" paintOrder="stroke">
            <title>{edge.label}</title>{edge.label.length > 35 ? `${edge.label.slice(0, 34)}…` : edge.label}
          </text>}
        </g>;
      })}
      {document.nodes.map((node) => <g key={node.id} role="button" tabIndex={disabled ? -1 : 0}
        aria-label={`${node.kind}: ${node.label}`} aria-pressed={selected === node.id}
        aria-haspopup="menu" aria-expanded={menu?.id === node.id && selected === node.id}
        transform={`translate(${node.x},${node.y})`} style={{ cursor: disabled ? 'default' : 'grab', touchAction: 'none' }}
        onClick={(event) => { event.stopPropagation(); if (!disabled && !suppressClick.current) openMenu(node.id, event.currentTarget); }}
        onContextMenu={(event) => { event.preventDefault(); if (!disabled) openMenu(node.id, event.currentTarget); }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); openMenu(node.id, event.currentTarget);
          }
          const directions: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
          const delta = directions[event.key];
          if (delta) { event.preventDefault(); move(node, node.x + delta[0], node.y + delta[1]); }
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (disabled || event.button !== 0) return;
          const svg = event.currentTarget.ownerSVGElement;
          if (!svg) return;
          const bounds = svg.getBoundingClientRect();
          setMenu(null);
          gesture.current = { x: event.clientX, y: event.clientY, moved: false };
          suppressClick.current = false;
          drag.current = { id: node.id, dx: (event.clientX - bounds.left) / zoom - node.x, dy: (event.clientY - bounds.top) / zoom - node.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}>
        {selected === node.id && <rect x="-3" y="-3" width="226" height="90" rx="15" fill="none" stroke={colors[node.kind]} strokeWidth="4" opacity=".5" filter={`url(#${marker}-glow)`} />}
        <rect width="220" height="84" rx="12" fill={`url(#${marker}-node)`} stroke={selected === node.id ? '#a5f3fc' : colors[node.kind]} strokeOpacity={selected === node.id ? 1 : .6} strokeWidth={selected === node.id ? 2 : 1} />
        <text x="16" y="25" fill={colors[node.kind]} fontSize="12">{node.kind === 'host'
          ? document.operations?.find((item) => item.id === node.referenceId)?.category.toUpperCase() ?? 'HOST' : node.kind.toUpperCase()}</text>
        <text x="16" y="52" fill="#f1f5f9" fontSize="14">{node.label.length > 25 ? `${node.label.slice(0, 24)}…` : node.label}</text>
        <text x="16" y="71" fill="#7e98b5" fontSize="9">{document.execution && node.run
          ? `${node.run.phases.join('/')} · ${node.run.output} · ${node.kind === 'host' ? 'host operation' : node.run.access}`
          : node.kind === 'agent'
          ? document.agents.find((agent) => agent.id === node.referenceId)?.provider || 'Choose agent'
          : node.kind === 'hook' ? document.hooks.find((hook) => hook.id === node.referenceId)?.action || 'Choose hook'
            : node.kind === 'host' ? document.execution || document.runtimeReference?.execution === 'host-runtime'
              ? 'Host enforced · runtime binding' : 'Host enforced · reference only' : 'Human decision'}</text>
        <circle cx="0" cy="42" r="4" fill={colors[node.kind]} /><circle cx="220" cy="42" r="4" fill={colors[node.kind]} />
      </g>)}
    </svg>
    </div>
    {menu && selected === menu.id && !disabled && <div ref={menuRef} role="menu" aria-label="Node actions"
      className="workflow-node-menu" style={{ left: menu.x, top: menu.y }}
      onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.findIndex((item) => item === event.target);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
        if (event.key === 'Escape' || event.key === 'Tab') {
          setMenu(null);
          if (event.key === 'Escape') { event.preventDefault(); nodeTrigger.current?.focus(); onDeselect(); }
        }
      }}>
      <p>{document.nodes.find((node) => node.id === menu.id)?.label}</p>
      <button role="menuitem" onClick={() => menuAction(onConfigure)}>{document.nodes.find((node) => node.id === menu.id)?.kind === 'host' ? 'Inspect host operation' : 'Configure node'}</button>
      <button role="menuitem" disabled={topologyLocked} onClick={() => menuAction(onDuplicate)}>Duplicate node</button>
      <button role="menuitem" disabled={topologyLocked} onClick={() => menuAction(onConnect)}>Connect to another node</button>
      <button role="menuitem" disabled={topologyLocked || document.nodes.length <= 1} onClick={() => menuAction(onDelete)}>Delete node</button>
      {topologyLocked && <p>Current orchestration topology is host-enforced.</p>}
    </div>}
    <p className="workflow-canvas-hint">Drag to pan · click a node for actions · Escape to clear</p>
    <div className="workflow-canvas-controls" role="group" aria-label="Canvas controls">
      <button aria-label="Zoom out" disabled={zoom <= .25} onClick={() => changeZoom(zoom - .1)}>-</button>
      <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
      <button aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => changeZoom(zoom + .1)}>+</button>
      <button onClick={fit}>Fit nodes</button>
      <button onClick={() => { setZoom(1); viewport.current?.scrollTo(0, 0); }}>Reset view</button>
    </div>
  </div>;
}
