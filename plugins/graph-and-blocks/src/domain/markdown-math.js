/** One math grammar for the host, documents and component text.
 * No source rewriting: mdast positions continue to address the saved Markdown.
 * Replace the upstream flow rule (which accepts an unclosed block at EOF),
 * rather than registering a fallback beside it. Inline/code rules stay intact.
 * This file is dependency-free so the version-checked host adapter can embed it.
 */
export function notaraMath(extension, {excluded = new Set(), excludedText = new Set(), onReject = () => {}, disableFlow = false} = {}) {
  const eol = code => code === -5 || code === -4 || code === -3;
  const space = code => code === 32 || code === -2 || code === -1;
  const spaces = (effects, next, type, max = Infinity) => {
    let size = 0;
    return function start(code) {
      if (!space(code) || size >= max) return next(code);
      effects.enter(type);
      return consume(code);
    };
    function consume(code) {
      if (space(code) && size < max) { size++; effects.consume(code); return consume; }
      effects.exit(type);
      return next(code);
    }
  };
  const continuation = { partial: true, tokenize(effects, ok, nok) {
    const self = this;
    return code => {
      if (!eol(code)) return nok(code);
      effects.enter('lineEnding'); effects.consume(code); effects.exit('lineEnding');
      return code => self.parser.lazy[self.now().line] ? nok(code) : ok(code);
    };
  } };
  const makeFlow = (marker = 36) => ({ concrete: true, name: marker === 36 ? 'notaraMathFlow' : 'notaraBackslashMathFlow', tokenize(effects, ok, nok) {
    const self = this, tail = self.events.at(-1);
    const offset = self.now().offset;
    const indent = tail?.[1].type === 'linePrefix' ? tail[2].sliceSerialize(tail[1], true).length : 0;
    let opening = 0, oddSlash = false;
    return start;
    function start(code) {
      if (code !== marker || excluded.has(offset)) return nok(code);
      effects.enter('mathFlow'); effects.enter('mathFlowFence'); effects.enter('mathFlowFenceSequence');
      if (marker === 92) { effects.consume(code); return bracketOpen; }
      return sequence(code);
    }
    function bracketOpen(code) {
      if (code !== 91) return nok(code);
      effects.consume(code); effects.exit('mathFlowFenceSequence'); effects.exit('mathFlowFence');
      return content;
    }
    function sequence(code) {
      if (code === 36) { opening++; effects.consume(code); return sequence; }
      if (opening < 2) return nok(code);
      effects.exit('mathFlowFenceSequence'); effects.exit('mathFlowFence');
      return content(code);
    }
    function content(code) {
      // Incomplete streaming/source content remains ordinary Markdown.
      if (code === null) return reject(code);
      if (code === marker && !oddSlash) return effects.attempt({partial: true, tokenize: closing}, closed, afterCloseAttempt)(code);
      if (eol(code)) return effects.attempt(continuation, afterLine, reject)(code);
      return valueStart(code);
    }
    function afterCloseAttempt(code) {
      // A complete delimiter followed by prose ends this candidate. It must
      // never be treated as TeX while searching for a later formula's closer.
      return effects.check({partial:true,tokenize:completeDelimiter}, reject,
        marker === 92 ? effects.check({partial:true,tokenize:openingBracket}, reject, valueStart) : valueStart)(code);
    }
    function reject(code) { onReject(offset); return nok(code); }
    function completeDelimiter(e,yes,no) {
      let size=0;
      return begin;
      function begin(code) {
        e.enter('chunkString');
        if(marker===92){e.consume(code);return code=>{if(code!==93)return no(code);e.consume(code);e.exit('chunkString');return yes;};}
        return run(code);
      }
      function run(code) {
        if(code===36){size++;e.consume(code);return run;}
        if(size<opening)return no(code);
        e.exit('chunkString');return yes(code);
      }
    }
    function openingBracket(checkEffects, checkOk, checkNok) {
      return code => {
        checkEffects.enter('chunkString'); checkEffects.consume(code);
        return code => {
          if(code !== 91)return checkNok(code);
          checkEffects.consume(code); checkEffects.exit('chunkString'); return checkOk;
        };
      };
    }
    function afterLine(code) {
      oddSlash = false;
      return effects.check({partial:true,tokenize:codeFence},reject,
        effects.attempt({partial: true, tokenize: closingLine}, closed,
          indent ? spaces(effects, content, 'linePrefix', indent) : content))(code);
    }
    function codeFence(e,yes,no){
      let marker,size=0;
      return spaces(e,start,'linePrefix',3);
      function start(code){
        if(code!==96&&code!==126)return no(code);
        marker=code;e.enter('chunkString');return run(code);
      }
      function run(code){
        if(code===marker){size++;e.consume(code);return run;}
        if(size<3)return no(code);
        e.exit('chunkString');return yes(code);
      }
    }
    function valueStart(code) {
      effects.enter('mathFlowValue');
      oddSlash = code === 92 ? !oddSlash : false;
      effects.consume(code);
      return value;
    }
    function value(code) {
      if (code === null || eol(code) || code === marker) { effects.exit('mathFlowValue'); return content(code); }
      oddSlash = code === 92 ? !oddSlash : false;
      effects.consume(code); return value;
    }
    function closed(code) { effects.exit('mathFlow'); return ok(code); }
    function closingLine(closeEffects, closeOk, closeNok) {
      return spaces(closeEffects, closing(closeEffects, closeOk, closeNok), 'linePrefix', 3);
    }
    function closing(closeEffects, closeOk, closeNok) {
      let size = 0;
      return begin;
      function begin(code) {
        if (code !== marker) return closeNok(code);
        closeEffects.enter('mathFlowFence'); closeEffects.enter('mathFlowFenceSequence');
        if (marker === 92) { closeEffects.consume(code); return bracketClose; }
        return run(code);
      }
      function bracketClose(code) {
        if(code !== 93)return closeNok(code);
        closeEffects.consume(code); closeEffects.exit('mathFlowFenceSequence');
        return spaces(closeEffects, end, 'whitespace');
      }
      function run(code) {
        if (code === 36) { size++; closeEffects.consume(code); return run; }
        if (size < opening) return closeNok(code);
        closeEffects.exit('mathFlowFenceSequence');
        return spaces(closeEffects, end, 'whitespace')(code);
      }
      function end(code) {
        if (code !== null && !eol(code)) return closeNok(code);
        closeEffects.exit('mathFlowFence'); return closeOk(code);
      }
    }
  } });
  const backslashText = {name:'notaraBackslashMathText', previous(code) {
    return code !== 92 || this.events.at(-1)?.[1].type === 'characterEscape';
  }, tokenize(effects, ok, nok) {
    let oddSlash=false;
    if(excludedText.has(this.now().offset))return nok;
    return code => {
      effects.enter('mathText'); effects.enter('mathTextSequence'); effects.consume(code);
      return code => {
        if(code !== 40)return nok(code);
        effects.consume(code); effects.exit('mathTextSequence'); return content;
      };
    };
    function content(code) {
      if(code===null)return nok(code);
      if(code===92&&!oddSlash)return effects.attempt({partial:true,tokenize:close},closed,afterClose)(code);
      if(eol(code)){effects.enter('lineEnding');effects.consume(code);effects.exit('lineEnding');oddSlash=false;return content;}
      return valueStart(code);
    }
    function afterClose(code) {
      return effects.check({partial:true,tokenize:open},nok,valueStart)(code);
    }
    function valueStart(code) {
      effects.enter('mathTextData');oddSlash=code===92?!oddSlash:false;effects.consume(code);return value;
    }
    function value(code) {
      if(code===null||code===92||eol(code)){effects.exit('mathTextData');return content(code);}
      oddSlash=false;effects.consume(code);return value;
    }
    function close(e,yes,no){return delimiter(e,yes,no,41,'mathTextSequence');}
    function open(e,yes,no){return delimiter(e,yes,no,40,'chunkString');}
    function delimiter(e,yes,no,end,type) {
      return code => {e.enter(type);e.consume(code);return code=>{if(code!==end)return no(code);e.consume(code);e.exit(type);return yes;};};
    }
    function closed(code){effects.exit('mathText');return ok(code);}
  } };
  const dollarText=extension.text[36];
  const guardedDollarText={...dollarText,tokenize(effects,ok,nok){
    return excludedText.has(this.now().offset)?nok:dollarText.tokenize.call(this,effects,ok,nok);
  }};
  return {...extension, flow: {...extension.flow, 36: disableFlow ? [] : makeFlow(), 92: disableFlow ? [] : makeFlow(92)}, text:{...extension.text,36:guardedDollarText,92:backslashText}};
}

/** A failed concrete flow can already have suppressed document-level lists or
 * quotes. Reparse the ORIGINAL source with that candidate excluded, instead of
 * treating micromark's local tokenizer rollback as a complete document reset.
 * Normal closed math takes one pass. Pathological malformed input is bounded
 * and ultimately falls back to ordinary Markdown with inline math only.
 */
export function notaraParseMath(parse, source, options, extension, {excludedFlow=new Set(),excludedText=new Set(),onReject=()=>{}}={}) {
  const excluded=new Set(excludedFlow);
  for(let pass=0;pass<=8;pass++){
    const rejected=new Set(),disableFlow=pass===8;
    let tree,error;
    try{
      tree=parse(source,{...options,extensions:[...(options.extensions??[]),notaraMath(extension,{excluded,excludedText,disableFlow,onReject:offset=>{rejected.add(offset);onReject(offset);}})]});
    }catch(cause){error=cause;}
    if(!rejected.size){if(error)throw error;return tree;}
    for(const offset of rejected)excluded.add(offset);
  }
}

/** Streaming grammar for the SDK's existing IncrementalMarkdownParser.
 * Only closed math nodes reach the supplied TeX validator. Failed candidates
 * reparse as ordinary Markdown, with BOTH delimiters excluded so a rejected
 * closer cannot steal the next formula's opener. Source and positions stay
 * untouched. A bounded cache avoids validating unchanged tail formulas again.
 *
 * Flow math may span arbitrarily many blank lines. Mark its pending opener's
 * top-level block so notaraMathFreezeBoundary keeps that source tail mutable;
 * a paragraph frozen before its closer arrives could otherwise never become
 * math. This metadata is render-only, never written into a saved message.
 */
export function notaraStreamingMathParser(parse, options, extension, validate) {
  if(typeof validate!=='function')throw new TypeError('Streaming math requires a TeX validator');
  const cache=new Map();
  const valid=node=>{
    const key=(node.type==='math'?'display:':'inline:')+node.value;
    if(cache.has(key))return cache.get(key);
    let accepted=false;
    try{accepted=validate(node.value,node.type==='math')!==false;}catch{}
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    cache.set(key,accepted);return accepted;
  };
  return source=>{
    const excludedFlow=new Set(),excludedText=new Set();
    let tree,pending;
    for(let pass=0;pass<8;pass++){
      const rejected=new Set(),invalid=[];
      tree=notaraParseMath(parse,source,options,extension,{excludedFlow,excludedText,onReject:offset=>rejected.add(offset)});
      const visit=node=>{
        if((node.type==='math'||node.type==='inlineMath')&&!valid(node))invalid.push(node);
        for(const child of node.children??[])visit(child);
      };
      visit(tree);
      pending=rejected.size?Math.min(...rejected):undefined;
      if(!invalid.length)break;
      for(const node of invalid){
        const start=node.position.start.offset,end=node.position.end.offset,raw=source.slice(start,end);
        if(node.type==='math')excludedFlow.add(start);
        const opening=/^(\$+|\\[[(])/.exec(raw)?.[0],closing=/(\$+|\\[)\]])[ \t]*$/.exec(raw);
        for(let i=0;i<(opening?.length??0);i++)excludedText.add(start+i);
        if(closing)for(let i=0;i<closing[1].length;i++)excludedText.add(start+closing.index+i);
      }
      // Malformed/adversarial tails stay plain rather than exposing TeX errors.
      if(pass===7)tree=parse(source,options);
    }
    if(pending!==undefined){
      const block=tree.children.find(node=>node.position?.end.offset>pending);
      if(block)block.data={...block.data,notaraMathPending:true};
    }
    return tree;
  };
}

/** Cap the SDK's normal two-block frontier without changing node positions,
 * keys, code-fence optimization, generation resets or frozen React caches. */
export function notaraMathFreezeBoundary(blocks, boundary) {
  const pending=blocks.findIndex(node=>node.data?.notaraMathPending);
  return pending<0?boundary:Math.min(boundary,pending);
}
