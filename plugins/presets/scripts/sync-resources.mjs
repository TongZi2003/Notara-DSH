import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const promptsRoot = new URL('../../../prompts/', import.meta.url);
const builtSkillsRoot = new URL('pi-skills-built/', promptsRoot);
const destination = new URL('../resources/', import.meta.url);

const manifestRaw = await readFile(new URL('manifest.json', promptsRoot));
const manifest = JSON.parse(manifestRaw.toString('utf8'));
if (!Array.isArray(manifest.skills) || !manifest.skills.length) {
  throw new Error('prompts/manifest.json must declare at least one skill');
}

const VALID_ROLE_KINDS = new Set(['coordinator', 'organizer', 'teacher', 'worker', 'companion', 'blind']);
await rm(builtSkillsRoot, { recursive: true, force: true });
await mkdir(builtSkillsRoot, { recursive: true });
await writeFile(new URL('.gitkeep', builtSkillsRoot), '');
await rm(destination, { recursive: true, force: true });

const skillArtifacts = new Map();
for (const skill of manifest.skills) {
  if (!skill.id || !skill.description || !skill.file || !Array.isArray(skill.roles) || !skill.roles.length) {
    throw new Error(`Invalid skill entry in manifest.json: ${JSON.stringify(skill)}`);
  }
  for (const kind of skill.roles) {
    if (!VALID_ROLE_KINDS.has(kind)) throw new Error(`Unknown role kind "${kind}" in skill ${skill.id}`);
  }
  const skillName = `notara-${skill.id}`;
  const body = (await readFile(new URL(skill.file, promptsRoot), 'utf8')).replace(/^\uFEFF/, '');
  const wrapped = Buffer.from(`---\nname: ${skillName}\ndescription: ${JSON.stringify(skill.description)}\n${skill.userInvocable === false ? 'user-invocable: false\n' : ''}---\n\n${body}`, 'utf8');
  const builtFile = new URL(`${skillName}/SKILL.md`, builtSkillsRoot);
  await mkdir(dirname(fileURLToPath(builtFile)), { recursive: true });
  await writeFile(builtFile, wrapped);

  const bundleFiles = [{ relPath: 'SKILL.md', bytes: wrapped, origin: `prompts/pi-skills-built/${skillName}/SKILL.md` }];
  for (const extra of skill.resources ?? []) {
    if (!extra?.path || !extra?.source || extra.path.startsWith('/') || extra.path.includes('..')) {
      throw new Error(`Invalid skill resource in ${skill.id}: ${JSON.stringify(extra)}`);
    }
    const extraSourceUrl = new URL(extra.source, promptsRoot);
    const extraBytes = await readFile(extraSourceUrl);
    const extraBuilt = new URL(`${skillName}/${extra.path}`, builtSkillsRoot);
    await mkdir(dirname(fileURLToPath(extraBuilt)), { recursive: true });
    await writeFile(extraBuilt, extraBytes);
    bundleFiles.push({ relPath: extra.path, bytes: extraBytes, origin: extra.source.replace(/^\.\.\//, '') });
  }
  skillArtifacts.set(skill.id, { skill, skillName, bundleFiles });
}

const hashes = {};
const origins = {};
async function emit(relPath, bytes, origin) {
  const target = new URL(relPath, destination);
  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  await writeFile(target, bytes);
  hashes[relPath] = createHash('sha256').update(bytes).digest('hex');
  origins[relPath] = origin;
}

const corePrompts = [
  'base.md',
  'lesson-judgments.md',
  'conversation-judgments.md',
  'learning-records.md',
  'coordinator.md',
  'material-organizer.md',
  'manifest.json',
  ...['deepseek', 'claude', 'gemini', 'gpt'].map(id => `companions/${id}.md`),
  ...['base', 'problem', 'review', 'exercise', 'general', 'lesson'].map(id => `workers/${id}.md`),
];
for (const file of corePrompts) {
  const content = await readFile(new URL(file, promptsRoot));
  await emit(file, content, `prompts/${file}`);
}

for (const { skill, skillName, bundleFiles } of skillArtifacts.values()) {
  for (const item of bundleFiles) {
    await emit(`pi-skills-built/${skillName}/${item.relPath}`, item.bytes, item.origin);
    for (const roleKind of skill.roles) {
      await emit(`role-skills/${roleKind}/${skillName}/${item.relPath}`, item.bytes, item.origin);
    }
  }
}

await writeFile(
  new URL('provenance.json', destination),
  `${JSON.stringify({ source: 'notara-core/prompts', sha256: hashes, origins }, null, 2)}\n`,
);
