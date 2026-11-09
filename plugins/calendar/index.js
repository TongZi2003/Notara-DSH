import {TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {projectCalendar} from './model.js';
import {civilDay} from '@oh-my-student/plugin-vault-sqlite/review-schedule';
import {rescheduleCalendarItem} from './reschedule.js';
export default class Calendar extends TypertRemoteService {
  static inject=['notaraVault'];
  constructor(ctx){super(ctx,'notaraCalendar');this.vault=ctx.notaraVault;}
  async view(input){const {workspaceId,from,to}=input;if(workspaceId===null)throw new Error('请先选择工作区');const entry=this.vault.forWorkspace(workspaceId);await entry.ready;return projectCalendar(entry.store.calendarSources(),{from,to,today:civilDay(new Date(this.vault.config.now?.()??Date.now()))});}
  async reschedule(input){const {workspaceId,...request}=input;if(workspaceId===null)throw new Error('请先选择工作区');const entry=this.vault.forWorkspace(workspaceId);await entry.ready;return rescheduleCalendarItem(entry.store,request,new Date(this.vault.config.now?.()??Date.now()));}
}
Object.defineProperty(Calendar.prototype,'@deepseek-ai/dsh-typert-protocol/remote-methods',{value:{version:1,methods:['view','reschedule'].map(method=>({method,invocation:{kind:'direct'}}))}});
