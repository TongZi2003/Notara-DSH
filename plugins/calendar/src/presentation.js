import {parseReference} from '@oh-my-student/plugin-vault-sqlite/file-reference';

const shortDate=day=>`${Number(day.slice(5,7))}月${Number(day.slice(8))}日`;
export function selectedDateLabel(day){
  return `${shortDate(day)} 周${'日一二三四五六'[new Date(day+'T12:00:00Z').getUTCDay()]}`;
}
export function dateStatus(day,today,completed=false){
  if(day<today&&!completed)return {text:`逾期 ${Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'))/86400000)} 天`,overdue:true};
  return {text:day===today?'今天':(day.slice(0,4)!==today.slice(0,4)?day.slice(0,4)+'年':'')+shortDate(day),overdue:false};
}

// Move only explicitly appended source references. An inline link can be the
// object of the task itself; removing it would change what the student reads.
export function planPresentation(text){
  let title=text;const sources=[];
  while(true){
    const match=/\s+·\s+(\[\[[^\]\r\n]+\]\])\s*$/.exec(title);
    if(!match)break;
    const reference=parseReference(match[1]),prefix=title.slice(0,match.index).trimEnd();
    if(!reference||!prefix)break;
    sources.unshift(reference);title=prefix;
  }
  return {title,sources};
}
