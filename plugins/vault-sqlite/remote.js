/** Browser-safe Typert descriptors; no host imports. DTO authority: ../CONTRACT.md. */
export const VAULT_REMOTE_METHODS = Object.freeze([
  'homeRecommendations', 'homeSession', 'query', 'graph', 'read', 'save', 'toggleTask', 'recordReview', 'undoReview', 'scheduleReview',
  'drawingCommit','drawingActivity','drawingPreview',
  'lessonPlan', 'bindLessonPlan', 'setCurrentLessonTask', 'toggleLessonTask', 'lessonBindings',
  'whiteboard', 'setWhiteboard',
  'changes',
]);
export const REMOTE_CONTRIBUTION = {
  package: '@oh-my-student/plugin-vault-sqlite',
  descriptors: VAULT_REMOTE_METHODS.map(method => ({
    id: `@oh-my-student/plugin-vault-sqlite#notaraVault/${method}`,
    service: 'notaraVault', namespace: 'notaraVault', method,
    ...(method === 'changes' ? { mode: 'stream', cancellation: { parameter: 'signal' } } : {}),
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: {
      mode: 'strict', typeSymbol: '@oh-my-student/plugin-vault-sqlite#Input', create: () => objectCodec,
    } }],
    result: { mode: 'strict', typeSymbol: '@oh-my-student/plugin-vault-sqlite#Result', create: () => objectCodec },
  })),
};
const objectCodec = { parse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('vault_input_invalid');
  return value;
} };

// Only src/client.jsx mounts this contribution. UI consumers inject the namespace.
