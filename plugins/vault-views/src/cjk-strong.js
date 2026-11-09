/*!
 * CJK emphasis compatibility from @deepseek-ai/dsh-client-ui-primitives 0.2.0-rc.1.
 * MIT License
 *
 * Copyright (c) 2026 DeepSeek
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { attention } from "micromark-core-commonmark";
import { unicodePunctuation } from "micromark-util-character";
import { classifyCharacter } from "micromark-util-classify-character";
import { codes, constants } from "micromark-util-symbol";

/** Let asterisk strong emphasis close after punctuation when CJK prose continues without whitespace. */
const cjkCharacter = new RegExp([
	"\\p{Script_Extensions=Han}",
	"\\p{Script_Extensions=Hiragana}",
	"\\p{Script_Extensions=Katakana}",
	"\\p{Script_Extensions=Hangul}",
	"\\p{Script_Extensions=Bopomofo}"
].join("|"), "u");
function isCjkCharacter(code) {
	return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code));
}
const tokenizeCjkFriendlyAttention = function(effects, ok, nok) {
	const configuredAttentionMarkers = this.parser.constructs.attentionMarkers.null;
	if (configuredAttentionMarkers === void 0) throw new Error("micromark CommonMark attention markers are unavailable");
	const attentionMarkers = configuredAttentionMarkers;
	const previous = this.previous;
	const before = classifyCharacter(previous);
	let marker = codes.eof;
	return start;
	function start(code) {
		/* v8 ignore next -- this text construct is dispatched only for an asterisk. */
		if (code !== codes.asterisk) return nok(code);
		marker = code;
		effects.enter("attentionSequence");
		return inside(code);
	}
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		const token = effects.exit("attentionSequence");
		const after = classifyCharacter(code);
		// NativeVaultMarkdown also normalizes opening CJK quotation marks. Do
		// that at the tokenizer boundary here so source offsets remain intact.
		const cjkStrongOpen = token.end.offset - token.start.offset >= 2 && isCjkCharacter(previous) && unicodePunctuation(code);
		const open = !after || after === constants.characterGroupPunctuation && Boolean(before) || attentionMarkers.includes(code) || cjkStrongOpen;
		const commonMarkClose = !before || before === constants.characterGroupPunctuation && Boolean(after) || attentionMarkers.includes(previous);
		const cjkStrongClose = token.end.offset - token.start.offset >= 2 && unicodePunctuation(previous) && isCjkCharacter(code);
		const close = commonMarkClose || cjkStrongClose;
		token._open = open;
		token._close = close;
		return ok(code);
	}
};
const cjkFriendlyAttention = {
	name: "cjkFriendlyAttention",
	resolveAll: attention.resolveAll,
	tokenize: tokenizeCjkFriendlyAttention
};
const cjkFriendlyStrongExtension = { text: { [codes.asterisk]: cjkFriendlyAttention } };
/**
* Extend CommonMark asterisk strong emphasis for punctuation-delimited CJK
* prose, as a micromark syntax extension for `fromMarkdown`.
* @returns The micromark syntax extension.
*/
export function cjkFriendlyStrong() {
	return cjkFriendlyStrongExtension;
}
