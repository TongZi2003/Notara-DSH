import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crepe } from '@milkdown/crepe';
import { $node, $remark, $view, $prose, replaceAll } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { undoDepth } from '@milkdown/kit/prose/history';
import { undoCommand } from '@milkdown/kit/plugin/history';
import { Decoration } from '@milkdown/kit/prose/view';
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload';
import { commandsCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core';
import { prepareRichSource, finishRichSource } from './rich-source.js';
import { CodeMirrorEditor } from './markdown-editor.jsx';
import { parseReference } from './logic.js';
import baseStyle from '@milkdown/crepe/theme/common/style.css';
import frameStyle from '@milkdown/crepe/theme/frame.css';

function RichCapsule({ node, onChange, renderContent, onOpen, onSave }) {
  const [editing, setEditing] = useState(false), [raw, setRaw] = useState(node.attrs.raw), original = useRef(node.attrs.raw);
  useEffect(() => setRaw(node.attrs.raw), [node.attrs.raw]);
  if (node.attrs.kind === 'reference') {
    const ref = parseReference(node.attrs.raw);
    return <button type="button" className="nv-inline-reference" onClick={() => ref && onOpen?.(ref)} title={node.attrs.raw}>{ref?.label || node.attrs.raw}</button>;
  }
  return <div className="nv-rich-capsule" data-kind={node.attrs.kind}>
    <div className="nv-rich-capsule-actions"><button type="button" onClick={() => { if (!editing) original.current = node.attrs.raw; setEditing(value => !value); }}>{editing ? '完成' : node.attrs.kind === 'component' ? '编辑组件' : '编辑内容'}</button>{editing && <button onClick={() => { onChange(original.current); setRaw(original.current); setEditing(false); }}>取消修改</button>}</div>
    {editing && <CodeMirrorEditor value={raw} onChange={value => { setRaw(value); onChange(value); }} onSave={onSave} />}
    <div className="nv-rich-capsule-preview">{renderContent(editing ? raw : node.attrs.raw, `capsule:${node.attrs.token}`)}</div>
  </div>;
}

function installCapsules(crepe, prepared, callbacks) {
  const schema = (name, inline) => $node(name, () => ({
    group: inline ? 'inline' : 'block', inline, atom: true, selectable: true,
    attrs: { raw: { default: '' }, kind: { default: '' }, token: { default: '' } },
    parseDOM: [{ tag: `${inline ? 'span' : 'div'}[data-notara-preserved]`, getAttrs: dom => ({ raw: dom.getAttribute('data-notara-preserved'), kind: dom.dataset.kind }) }],
    toDOM: node => [inline ? 'span' : 'div', { 'data-notara-preserved': node.attrs.raw, 'data-kind': node.attrs.kind }, node.attrs.raw],
    parseMarkdown: { match: n => n.type === name, runner: (state, n, type) => state.addNode(type, n.value) },
    toMarkdown: { match: n => n.type.name === name, runner: (state, n) => state.addNode(inline ? 'notaraRawInline' : 'notaraRawBlock', undefined, n.attrs.raw) },
  }));
  const block = schema('notara_block', false), inline = schema('notara_inline', true);
  const remark = $remark('notara-preserved-syntax', () => () => tree => {
    const visit = parent => {
      if (!parent.children) return;
      parent.children = parent.children.flatMap(node => {
        if (node.type === 'code' && node.lang === 'notara-preserved') {
          const capsule = prepared.current.capsules.get(node.value.trim());
          if (capsule) return [{ type: 'notara_block', value: { ...capsule, token: node.value.trim() } }];
        }
        if (node.type === 'text') {
          const pieces = [], regex = /NVREF\d+X[a-z0-9]+END/g; let offset = 0;
          for (const match of node.value.matchAll(regex)) {
            const capsule = prepared.current.capsules.get(match[0]); if (!capsule) continue;
            if (match.index > offset) pieces.push({ type: 'text', value: node.value.slice(offset, match.index) });
            pieces.push({ type: 'notara_inline', value: { ...capsule, token: match[0] } }); offset = match.index + match[0].length;
          }
          if (pieces.length) { if (offset < node.value.length) pieces.push({ type: 'text', value: node.value.slice(offset) }); return pieces; }
        }
        visit(node); return [node];
      });
    }; visit(tree);
  });
  const view = spec => $view(spec, () => (initial, editorView, getPos) => {
    let node = initial;
    const dom = document.createElement(initial.isInline ? 'span' : 'div'); dom.contentEditable = 'false';
    const id = crypto.randomUUID();
    const render = () => callbacks.current.portal(id, { dom, node, onChange: raw => { const pos = getPos(); if (typeof pos === 'number') editorView.dispatch(editorView.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw })); } });
    render();
    return { dom, update(next) { if (next.type !== node.type) return false; if (next.attrs.raw !== node.attrs.raw) { node = next; render(); } else node = next; return true; }, stopEvent: event => dom.contains(event.target), ignoreMutation: mutation => mutation.type !== 'selection', destroy() { callbacks.current.portal(id, null); } };
  });
  crepe.editor.config(ctx => ctx.update(remarkStringifyOptionsCtx, previous => ({ ...previous, handlers: { ...previous.handlers, notaraRawBlock: node => node.value, notaraRawInline: node => node.value } }))).use(remark).use(block).use(inline).use(view(block)).use(view(inline));
}

export function MilkdownEditor({ value, onChange, onSave, onActions, renderContent, onOpen }) {
  const host = useRef(null), editor = useRef(null), prepared = useRef(null), callbacks = useRef(null), output = useRef(value), ready = useRef(false), syncing = useRef(false);
  const baseline = useRef(null);
  const latestValue = useRef(value); latestValue.current = value;
  const [failed, setFailed] = useState(false), [loading, setLoading] = useState(true), [uploadNotice, setUploadNotice] = useState(''), [portals, setPortals] = useState(new Map()), mounted = useRef(true);
  callbacks.current = { onChange, onSave, onActions, renderContent, onOpen, portal: (id, value) => queueMicrotask(() => { if (mounted.current) setPortals(previous => { const next = new Map(previous); if (value) next.set(id, value); else next.delete(id); return next; }); }) };
  const applyExternal = () => {
    if (!ready.current || latestValue.current === output.current) return;
    syncing.current = true; prepared.current = prepareRichSource(latestValue.current); output.current = latestValue.current;
    try { editor.current.editor.action(replaceAll(prepared.current.source, true)); }
    finally { syncing.current = false; }
  };
  useEffect(() => {
    let live = true; mounted.current = true;
    prepared.current = prepareRichSource(value);
    const onUpload = file => new Promise(resolve => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) { setUploadNotice('请插入 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片。'); resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => { if (live) setUploadNotice(''); resolve(String(reader.result)); };
      reader.onerror = () => { if (live) setUploadNotice('图片未能读取，请重试。'); resolve(''); };
      reader.readAsDataURL(file);
    });
    const crepe = new Crepe({ root: host.current, defaultValue: prepared.current.source, features: { [Crepe.Feature.AI]: false, [Crepe.Feature.TopBar]: false, [Crepe.Feature.Latex]: true }, featureConfigs: { [Crepe.Feature.Placeholder]: { text: '在这里开始书写…' }, [Crepe.Feature.CodeMirror]: { previewOnlyByDefault: true }, [Crepe.Feature.ImageBlock]: { onUpload, blockUploadButton: '插入图片', inlineUploadButton: '插入图片', blockCaptionPlaceholder: '图片说明', blockUploadPlaceholderText: '或粘贴图片链接' } } });
    crepe.editor.use(upload).config(ctx => ctx.update(uploadConfig.key, previous => ({ ...previous,
      uploader: async (files, schema) => { const images = await Promise.all(Array.from(files).map(async file => { const src = await onUpload(file); return src ? schema.nodes.image.createAndFill({ src, alt: file.name }) : null; })); return images.filter(Boolean); },
      uploadWidgetFactory: (pos, spec) => { const element = document.createElement('span'); element.textContent = '正在插入图片…'; return Decoration.widget(pos, element, spec); },
    })));
    crepe.editor.config(ctx => ctx.update(editorViewOptionsCtx, previous => ({ ...previous, attributes: { ...previous.attributes, 'aria-label': 'Markdown 所见即所得编辑器', role: 'textbox', 'aria-multiline': 'true' }, handleKeyDown: (view, event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); callbacks.current.onSave?.(); return true; } return previous.handleKeyDown?.(view, event) || false; } })));
    installCapsules(crepe, prepared, callbacks);
    crepe.editor.use($prose(ctx => new Plugin({ view(view) {
      const owner = Symbol('rich-editor'); let alive = true, lastUndo;
      const undo = () => { if (!alive || !view.editable) return false; view.focus(); return ctx.get(commandsCtx).call(undoCommand.key); };
      const publish = () => { const canUndo = undoDepth(view.state) > 0; if (canUndo === lastUndo) return; lastUndo = canUndo; callbacks.current.onActions?.(owner, { canUndo, undo }); };
      publish();
      return { update: publish, destroy() { alive = false; callbacks.current.onActions?.(owner, null); } };
    } })));
    // Persist each document transaction. Milkdown's listener is debounced and
    // would otherwise lose the last keystrokes when a tab closes or Mod-S fires.
    crepe.editor.use($prose(ctx => new Plugin({ view(initialView) {
      baseline.current = { doc: initialView.state.doc, text: output.current };
      return { update(view, previous) {
        if (!live) return;
        if (syncing.current) { baseline.current = { doc: view.state.doc, text: output.current }; return; }
        if (!ready.current || previous.doc.eq(view.state.doc)) return;
        // Undoing back to the received document restores its exact source too;
        // formatting normalization alone must not leave an unsaved change.
        const next = baseline.current?.doc.eq(view.state.doc) ? baseline.current.text : finishRichSource(ctx.get(serializerCtx)(view.state.doc), prepared.current);
        output.current = next; callbacks.current.onChange(next);
      } };
    } })));
    editor.current = crepe;
    void crepe.create().then(() => { if (!live) { void crepe.destroy(); return; } ready.current = true; applyExternal(); setLoading(false); }).catch(error => { console.error('Markdown editor initialization failed', error); if (live) { setFailed(true); setLoading(false); } });
    return () => { live = false; mounted.current = false; ready.current = false; editor.current = null; if (crepe.editor.status === 'Created') void crepe.destroy(); };
  }, []);
  useEffect(applyExternal, [value]);
  return <div className="nv-milkdown-editor"><style data-plugin="@oh-my-student/plugin-vault-views">{baseStyle + '\n' + frameStyle}</style>{loading && <p role="status">正在准备编辑器…</p>}{failed && <p role="alert">编辑器暂时无法加载，可切换源码继续编辑。</p>}{uploadNotice && <p role="status">{uploadNotice}</p>}<div ref={host} />{[...portals].map(([id, item]) => createPortal(<RichCapsule node={item.node} onChange={item.onChange} renderContent={renderContent} onOpen={onOpen} onSave={onSave} />, item.dom, id))}</div>;
}
