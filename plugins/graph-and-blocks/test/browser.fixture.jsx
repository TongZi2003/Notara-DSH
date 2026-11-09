import React from 'react';
import { createRoot } from 'react-dom/client';
import { InteractiveBlocks } from '../src/blocks.jsx';
import { ForceGraphView } from '../src/graph-view.jsx';
import { installMarkdownBlocks } from '../src/markdown-extension.jsx';
import { CanvasBlocks } from '../src/canvas.jsx';
import styles from '../src/styles.css';
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const root = createRoot(document.getElementById('root'));
window.submitted = [];
window.opened = [];
window.graphCommits = 0;
window.failSubmit = false;
window.installMarkdownBlocks = installMarkdownBlocks;
window.React = React;
window.renderFixture = ({ source = '', graph, canvas, duplicate = false, remoteFail = false, scope = 'fixture-classroom' }) => {
  const submit = async data => { if (window.failSubmit) throw new Error('fixture failure'); window.submitted.push(data.text); };
  root.render(<main><div data-copy="one"><InteractiveBlocks source={source} scope={scope} nodeId="fixture-node" onSubmit={submit} /></div>{duplicate && <div data-copy="two"><InteractiveBlocks source={source} scope={scope} nodeId="fixture-node" onSubmit={submit} /></div>}{canvas && <CanvasBlocks content={canvas} scope={scope} onSubmit={submit} onOpenDocument={value => window.opened.push(value)} />}{graph && <React.Profiler id="graph" onRender={() => window.graphCommits++}><ForceGraphView key={remoteFail ? 'fail' : 'graph'} data={remoteFail ? undefined : graph} ctx={{ remote: { notaraVault: { graph: async () => { if (remoteFail) return { ok: false, error: { message: 'fixture failure' } }; return { ok: true, value: graph }; } } } }} onOpenDocument={value => window.opened.push(value)} /></React.Profiler>}</main>);
};
