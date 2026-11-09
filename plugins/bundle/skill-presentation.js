/** Display-only faces. Native names remain the search, clipboard and send IDs. */
export function createSkillPresentation(faces){
  const face=name=>Object.hasOwn(faces,name)?faces[name]:undefined;
  return {
    label:name=>face(name)?.title??name,
    referenceLabel:name=>face(name)?.title??`/${name}`,
    candidates:(skills,userOnly)=>skills.map(skill=>{
      const display=face(skill.name);
      return {name:skill.name,...display?{label:display.title,notaraSkill:true}:{},description:display?.summary??(skill.modelInvocable?skill.description:`${userOnly} · ${skill.description}`)};
    }),
    pick:candidate=>face(candidate.name)?{insert:{source:'skill',ref:`/${candidate.name}`,label:face(candidate.name).title,clipboardText:`/${candidate.name}`}}:{text:`/${candidate.name} `},
    codec:{clipboardText:ref=>ref,serialize:async ref=>ref},
  };
}
