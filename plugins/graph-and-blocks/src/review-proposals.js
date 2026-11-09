import { splitBoardBody, readComponent } from './domain/board-components.js';
import { studentMarkdown } from './domain/student-markdown.js';
import { splitDrawingBlocks } from './drawing-blocks.js';
import { conversationMarkdown } from './conversation-markdown-model.js';

/** Follow the same visible text leaves and offsets as ExtendedAssistant and
 * InteractiveBlocks. Hidden references, retired components, drawing splits
 * and details must not move a persisted (messageId, component index) receipt. */
export function conversationReviewProposals(source) {
  const safe = studentMarkdown(source), drawing = splitDrawingBlocks(safe);
  const parts = drawing.some(part => part.type === 'drawing') ? drawing : [{ type: 'text', text: safe }];
  const proposals = [];
  let offset = 0;
  const read = (text, index) => {
    for (const segment of splitBoardBody(studentMarkdown(text.slice(0, 120000))).segments) {
      if (segment.kind !== 'component' || segment.type !== 'notara-review') continue;
      const component = readComponent({ ...segment, index: segment.index + index });
      if (!component.error) proposals.push({ index: component.index, targetPath: component.spec.targetPath,...component.spec.heading?{heading:component.spec.heading}:{} });
    }
  };
  const visit = nodes => {
    for (const node of nodes) {
      if (node.kind === 'details') visit(node.children);
      else if (node.kind === 'markdown') read(node.text, offset + node.componentOffset);
    }
  };
  for (const part of parts) {
    if (part.type !== 'text') continue;
    const markup = conversationMarkdown(part.text);
    if (markup.special) visit(markup.nodes);
    else read(part.text, offset);
    offset += splitBoardBody(part.text).segments.filter(segment => segment.kind === 'component' || segment.kind === 'retired').length;
  }
  return proposals;
}
