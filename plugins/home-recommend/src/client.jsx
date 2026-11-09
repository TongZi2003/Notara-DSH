import { registerReference } from './composer.js';
import { SkillEntrances } from './SkillEntrances.jsx';

// Keep the public components available without mounting the withdrawn home UI.
export { HomeRecommend, HomeRecommendDock } from './HomeRecommend.jsx';

export default {
  name: 'notara-home-recommend',
  inject: ['remote', 'slots', 'remote.notaraVault', 'conversation', 'sessions', 'inputTriggers'],
  apply(ctx) {
    // Existing native drafts may still contain these references. Removing the
    // homepage must not invalidate them or rewrite saved learner content.
    ctx.effect(() => registerReference(ctx));
    ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({name:'conversation.composer.dock',id:'notara-skill-entrances',order:20},SkillEntrances)));
  },
};
