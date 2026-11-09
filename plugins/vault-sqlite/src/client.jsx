import { REMOTE_CONTRIBUTION } from '../remote.js';

/** The single owner of this namespace. UI plugins only inject remote.notaraVault. */
export default {
  name: '@oh-my-student/plugin-vault-sqlite/client',
  inject: ['remote'],
  async apply(ctx) {
    await ctx.effect(async () => ctx.remote.$mount(REMOTE_CONTRIBUTION));
  },
};
