import React from 'react';

export function ConversationMarkdown({ nodes, renderText, renderSummary }) {
  return <div className="nv-chat-markdown">{nodes.map(node => node.kind === 'details'
    ? <details className="nv-chat-fold" key={node.start}><summary>{renderSummary(node.summary)}</summary><ConversationMarkdown nodes={node.children} renderText={renderText} renderSummary={renderSummary}/></details>
    : node.kind === 'table' ? <div className="nv-chat-table" key={node.start}><table><thead><tr>{node.headers.map((cell, i) => <th key={i} scope="col" style={{ textAlign: node.align[i] || undefined }}>{renderSummary(cell + '\n\n' + node.definitions)}</th>)}</tr></thead><tbody>{node.rows.map((row, n) => <tr key={n}>{row.map((cell, i) => <td key={i} style={{ textAlign: node.align[i] || undefined }}>{renderSummary(cell + '\n\n' + node.definitions)}</td>)}</tr>)}</tbody></table></div>
    : <React.Fragment key={node.start}>{renderText(node.text, node.componentOffset)}</React.Fragment>)}</div>;
}
