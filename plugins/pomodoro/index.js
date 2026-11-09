import {TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {ClassroomTimer} from './model.js';
import {METHODS} from './remote.js';
export default class Pomodoro extends TypertRemoteService {
  static inject=['schedule','sessionController'];
  constructor(ctx){super(ctx,'notaraPomodoro');this.timer=new ClassroomTimer(ctx.schedule);this.controller=ctx.sessionController;}
  status(input){return this.timer.status(input);}
  async start(input){const {meta}=await this.controller.inspect(input?.sessionId);if(meta.origin==='subagent'||(meta.delegationDepth??0)>0)throw new Error('请在主课堂中开始计时');return this.timer.start(input);}
  stop(input){return this.timer.stop(input);}
}
Object.defineProperty(Pomodoro.prototype,'@deepseek-ai/dsh-typert-protocol/remote-methods',{value:{version:1,methods:METHODS.map(method=>({method,invocation:{kind:'direct'}}))}});
