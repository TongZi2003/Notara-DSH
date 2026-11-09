export function fixture(){
  const nodes=[{path:'原书.pdf',title:'原书',type:'pdf',isSource:true},
    ...['A','B','C','D','E','F'].map((path,i)=>({path,title:`知识${path}`,type:i%2?'method':'concept',sourcePaths:['原书.pdf'],tags:[]})),
    ...['题目','实验','历史事件','医学病案'].map(title=>({path:title,title,type:'exercise',sourcePaths:['原书.pdf'],tags:['[[A|别名]]','A','[[B]]'],knowledgeTags:[{raw:'[[A|别名]]',target:'A',label:'别名'},{raw:'[[B]]',target:'B',label:'知识B'}]}))];
  const edges=[],add=(source,target,kind,context='',style='dashed')=>edges.push({source,target,kind,context,style,id:JSON.stringify([kind,source,target,context])});
  for(const a of ['A','B','C','D','E','F'])for(const b of ['A','B','C','D','E','F'])if(a!==b)add(a,b,'reference');
  add('A','B','prerequisite','路线一','solid');add('A','B','prerequisite','路线二');add('B','C','prerequisite');add('C','B','prerequisite');add('A','C','prerequisite');
  add('A','B','association','比较');
  for(const n of nodes.filter(n=>n.type==='exercise')){add('A',n.path,'example');add('B',n.path,'example');add(n.path,'原书.pdf','source');}
  return {relationsVersion:2,nodes,edges};
}
