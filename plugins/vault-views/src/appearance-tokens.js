// Existing default palette, retained for reversible appearance switching.
const pair=(light,dark=light)=>({light,dark});
export const CLAUDE_TOKENS = {
        '--dsw-alias-bg-base': { light: '#faf9f5', dark: '#171614' },
        '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#22201d' },
        '--dsw-alias-bg-layer-2': { light: '#f0eee6', dark: '#2a2824' },
        '--dsw-alias-bg-layer-3': { light: '#e8e6dc', dark: '#34312c' },
        '--dsw-alias-bg-module-platform': { light: '#f4f2ea', dark: '#1b1a17' },
        '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#2a2824' },
        '--dsw-alias-border-l1': { light: '#1f1e1c1a', dark: '#e7e2d814' },
        '--dsw-alias-border-l2': { light: '#1f1e1d40', dark: '#dedcd140' },
        '--dsw-alias-border-l3': { light: '#1f1e1d4d', dark: '#dedcd14d' },
        '--dsw-alias-border-l4': { light: '#1f1e1d66', dark: '#dedcd166' },
        '--dsw-alias-brand-primary': { light: '#b5573a', dark: '#e3987a' },
        '--dsw-alias-brand-text': { light: '#1f1e1c', dark: '#e7e2d8' },
        '--dsw-alias-button-primary-fill': { light: '#b5573a', dark: '#b5573a' },
        '--dsw-alias-button-primary-hover': { light: '#9a4529', dark: '#a34d31' },
        '--dsw-alias-button-info-fill': { light: '#b5573a', dark: '#b5573a' },
        '--dsw-alias-button-info-hover': { light: '#9a4529', dark: '#a34d31' },
        '--dsw-alias-interactive-bg-hover': { light: '#f0eee6', dark: '#2a2824' },
        '--dsw-alias-interactive-bg-hover-solid': { light: '#f0eee6', dark: '#2a2824' },
        '--dsw-alias-interactive-bg-active': { light: '#e8e6dc', dark: '#34312c' },
        '--dsw-alias-label-primary': { light: '#2a2925', dark: '#e7e2d8' },
        '--dsw-alias-label-secondary': { light: '#6b6963', dark: '#b9b2a5' },
        // Small labels still clear 4.5:1 on the warm sidebar; #9a978f does not.
        '--dsw-alias-label-tertiary': { light: '#706e66', dark: '#aaa295' },
        '--dsw-alias-label-caption': { light: '#706e66', dark: '#aaa295' },
        '--dsw-alias-link': { light: '#2a2925', dark: '#e7e2d8' },
        '--dsw-alias-label-link': { light: '#2a2925', dark: '#e7e2d8' },
        '--dsw-alias-state-business-primary': { light: '#b5573a', dark: '#e3987a' },
        '--dsw-alias-state-business-tertiary': { light: '#f5e6df', dark: '#3d2b24' },
        '--dsw-alias-markdown-code-block': { light: '#f3f1ea', dark: '#1f1e1d' },
        '--dsw-alias-markdown-code-block-banner': { light: '#ebe8de', dark: '#2a2927' },
        '--dsw-alias-markdown-inline-code': { light: '#f0eee6', dark: '#30302e' },
        '--dsw-alias-markdown-tag': { light: '#f0eee6', dark: '#30302e' },
        '--dsw-specific-sidebar-fill': { light: '#f4f2ea', dark: '#1b1a17' },
        '--dsw-specific-sidebar-nav-item-active': { light: '#e8e6dc', dark: '#34312c' },
        '--dsw-specific-sidebar-nav-item-hover': { light: '#f0eee6', dark: '#22201d' },
        '--dsw-specific-sidebar-nav-item-active-accent': { light: '#f5e6df', dark: '#3d2b24' },
        '--dsw-specific-bubble': { light: '#efece3', dark: '#22201d' },
        '--dsw-specific-bubble-highlight': { light: '#e8e6dc', dark: '#30302e' },
        '--dsw-specific-input-major': { light: '#ffffff', dark: '#22201d' },
        '--dsw-specific-selector': { light: '#f0eee6', dark: '#22201d' },
        '--dsw-font-family': {
          light: '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
          dark: '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
        },
        '--ds-font-family-code': {
          light: '"Source Han Sans SC", "Noto Sans SC", ui-monospace, SFMono-Regular, monospace',
          dark: '"Source Han Sans SC", "Noto Sans SC", ui-monospace, SFMono-Regular, monospace',
        },
        '--dsw-font-markdown-base': {
          light: 'calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: 'calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-base-font-family': {
          light: 'var(--claude-font-serif)',
          dark: 'var(--claude-font-serif)',
        },
        '--dsw-font-markdown-base-strong': {
          light: '600 calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: '600 calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-base-italic': {
          light: 'italic calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: 'italic calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-base-strong-italic': {
          light: 'italic 600 calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: 'italic 600 calc(var(--dsh-content-font-size, 15px) + 1px) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-h1': {
          light: '600 calc(22px + var(--dsh-content-font-delta, 0px)) / calc(32px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: '600 calc(22px + var(--dsh-content-font-delta, 0px)) / calc(32px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-h2': {
          light: '600 calc(19px + var(--dsh-content-font-delta, 0px)) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: '600 calc(19px + var(--dsh-content-font-delta, 0px)) / calc(28px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-h3': {
          light: '600 calc(17px + var(--dsh-content-font-delta, 0px)) / calc(26px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: '600 calc(17px + var(--dsh-content-font-delta, 0px)) / calc(26px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-h4': {
          light: '600 var(--dsh-content-font-size, 15px) / calc(24px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
          dark: '600 var(--dsh-content-font-size, 15px) / calc(24px + var(--dsh-content-font-delta, 0px)) var(--claude-font-serif)',
        },
        '--dsw-font-markdown-code': {
          light: '12.5px / 19px var(--claude-font-mono)',
          dark: '12.5px / 19px var(--claude-font-mono)',
        },
        '--dsw-font-markdown-code-block': {
          light: '12px / 19px var(--claude-font-mono)',
          dark: '12px / 19px var(--claude-font-mono)',
        },
      };

const sans='-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", sans-serif';
const mono='"SFMono-Regular", Consolas, "Liberation Mono", monospace';
const claudeVariables={
  '--nv-structural-line':pair('#e6e3da','#302d27'),
  '--nv-tab-strip-bg':pair('#f4f2ea','#12110f'),
  '--claude-font-serif':pair('Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", "STSong", serif'),
  '--claude-font-sans':pair('"Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif'),
  '--claude-font-mono':pair('"SF Mono", "JetBrains Mono", "Source Han Sans SC", "Noto Sans SC", ui-monospace, SFMono-Regular, monospace'),
  // Accent text/lines clear 4.5:1 on paper in both schemes; filled buttons keep
  // the deeper tone so light on-accent text stays readable in dark mode too.
  '--claude-clay':pair('#b5573a','#e3987a'), '--claude-clay-hover':pair('#9a4529','#eeb196'), '--claude-clay-active':pair('#7a3620','#f3c4ad'),
  '--claude-clay-soft':pair('color-mix(in srgb, #b5573a 12%, transparent)','color-mix(in srgb, #e3987a 16%, transparent)'), '--claude-clay-border':pair('#b5573a59','#e3987a59'),
  '--claude-code-bg':pair('#3d3d3a12','#c2c0b617'), '--claude-code-fg':pair('#8a2424','#f4a9a9'),
  '--claude-pre-bg':pair('#ffffff99','#14141399'), '--claude-table-th-border':pair('#1f1e1d99','#dedcd199'), '--claude-table-td-border':pair('#1f1e1d38','#dedcd138'),
  '--claude-composer-shadow':pair('0 4px 20px rgb(31 30 28 / 6%), 0 0 0 .5px rgb(31 30 28 / 15%)','0 1px 0 rgb(255 255 255 / 4%) inset, 0 8px 24px -8px rgb(0 0 0 / 35%)'),
  '--nv-overlay-shadow':pair('0 12px 32px -8px rgb(31 30 28 / 16%), 0 2px 6px rgb(31 30 28 / 5%)','0 1px 0 rgb(255 255 255 / 4%) inset, 0 12px 32px -8px rgb(0 0 0 / 50%), 0 2px 6px rgb(0 0 0 / 30%)'),
  '--notara-accent-fill':pair('#b5573a'), '--notara-accent-fill-hover':pair('#9a4529','#a34d31'), '--notara-on-accent':pair('#fdfbf7'), '--dsw-focus-ring-color':pair('#b5573a','#e3987a'),
};

export const APPEARANCE_TOKENS={
  claude:{...CLAUDE_TOKENS,...claudeVariables},
  obsidian:{...CLAUDE_TOKENS,
    '--nv-structural-line':pair('#e5e5e8','#2e2e33'),
    '--nv-tab-strip-bg':pair('#f5f5f6','#18181b'),
    '--claude-font-serif':pair(sans), '--claude-font-sans':pair(sans), '--claude-font-mono':pair(mono),
    '--dsw-font-family':pair(sans), '--ds-font-family-code':pair(mono),
    '--claude-clay':pair('#7d5daf','#bca7e8'), '--claude-clay-hover':pair('#76579f','#c4b5fd'), '--claude-clay-active':pair('#68498f','#ddd6fe'),
    '--claude-clay-soft':pair('#9474bd14','#bca7e81a'), '--claude-clay-border':pair('#9474bd45','#bca7e83d'),
    '--claude-code-bg':pair('#f3efff','#2d263c'), '--claude-code-fg':pair('#76579f','#c4b5fd'),
    '--claude-pre-bg':pair('#f7f7f9','#18181b'), '--claude-table-th-border':pair('#c3c3cd','#61616b'), '--claude-table-td-border':pair('#e5e5e8','#36363d'),
    '--claude-composer-shadow':pair('0 4px 20px rgb(20 24 32 / 5%), 0 0 0 .5px #d6d6dd','0 1px 0 rgb(255 255 255 / 4%) inset, 0 8px 24px -8px rgb(0 0 0 / 35%)'),
    '--nv-overlay-shadow':claudeVariables['--nv-overlay-shadow'],
    '--notara-accent-fill':pair('#715493'), '--notara-accent-fill-hover':pair('#614780'), '--notara-on-accent':pair('#faf9fc'), '--dsw-focus-ring-color':pair('#7d5daf','#bca7e8'),
    '--dsw-alias-bg-base':pair('#ffffff','#1e1e20'),
    '--dsw-alias-bg-layer-1':pair('#fafafa','#252529'),
    '--dsw-alias-bg-layer-2':pair('#f2f2f4','#2c2c31'),
    '--dsw-alias-bg-layer-3':pair('#e7e7ec','#38383f'),
    '--dsw-alias-bg-module-platform':pair('#f2f2f4','#18181b'),
    '--dsw-alias-bg-overlay':pair('#ffffff','#2c2c31'),
    '--dsw-alias-border-l1':pair('#22222514','#e6e6ec14'),
    '--dsw-alias-border-l2':pair('#d6d6dd','#45454f'),
    '--dsw-alias-border-l3':pair('#b5b5bf','#60606c'),
    '--dsw-alias-border-l4':pair('#9797a4','#82828f'),
    '--dsw-alias-brand-primary':pair('#7d5daf','#bca7e8'),
    '--dsw-alias-brand-text':pair('#222225','#e6e6ec'),
    '--dsw-alias-button-primary-fill':pair('#715493'), '--dsw-alias-button-primary-hover':pair('#614780'), '--dsw-alias-label-primary-foreground':pair('#faf9fc'),
    '--dsw-alias-button-info-fill':pair('#715493'), '--dsw-alias-button-info-hover':pair('#614780'),
    '--dsw-alias-interactive-bg-hover':pair('#f2f2f4','#2c2c31'), '--dsw-alias-interactive-bg-hover-solid':pair('#f2f2f4','#2c2c31'), '--dsw-alias-interactive-bg-active':pair('#e7e7ec','#38383f'),
    '--dsw-alias-label-primary':pair('#222225','#e6e6ec'), '--dsw-alias-label-secondary':pair('#57575f','#bdbdc8'), '--dsw-alias-label-tertiary':pair('#6f6f79','#a8a8b5'), '--dsw-alias-label-caption':pair('#6f6f79','#a8a8b5'),
    '--dsw-alias-link':pair('#7d5daf','#bca7e8'), '--dsw-alias-label-link':pair('#7d5daf','#bca7e8'),
    '--dsw-alias-state-business-primary':pair('#7d5daf','#bca7e8'), '--dsw-alias-state-business-tertiary':pair('#f1ebff','#30273f'),
    '--dsw-alias-markdown-code-block':pair('#f7f7f9','#18181b'), '--dsw-alias-markdown-code-block-banner':pair('#efeff2','#242428'), '--dsw-alias-markdown-inline-code':pair('#f3efff','#2d263c'), '--dsw-alias-markdown-tag':pair('#f1ebff','#30273f'),
    '--dsw-specific-sidebar-fill':pair('#f5f5f6','#18181b'), '--dsw-specific-sidebar-nav-item-active':pair('#e9e9ef','#303036'), '--dsw-specific-sidebar-nav-item-hover':pair('#ededf0','#252529'), '--dsw-specific-sidebar-nav-item-active-accent':pair('#f1ebff','#30273f'),
    '--dsw-specific-bubble':pair('#f2f2f4','#252529'), '--dsw-specific-bubble-highlight':pair('#e9e9ef','#38383f'), '--dsw-specific-input-major':pair('#ffffff','#252529'), '--dsw-specific-selector':pair('#efeff2','#2c2c31'),
  },
};

export const APPEARANCES=[{id:'claude',name:'Claude',description:'暖纸墨 · 衬线正文'},{id:'obsidian',name:'Obsidian',description:'冷静曜石 · 简洁正文'}];
export const normalizeAppearance=value=>Object.hasOwn(APPEARANCE_TOKENS,value)?value:'claude';
export function appearanceCss(name) {
  name=normalizeAppearance(name);const tokens=APPEARANCE_TOKENS[name],selector=`body[data-notara-theme="${name}"]`;
  const declarations=mode=>Object.entries(tokens).map(([key,value])=>`${key}:${value[mode]};`).join('');
  return `${selector}{${declarations('light')}}${selector}[data-ds-dark-theme]{${declarations('dark')}}`;
}
