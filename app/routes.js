export function routeFor(pathname,projects){
  const match=/^\/work\/([a-z0-9-]+)\/?$/.exec(pathname);
  if(match){const index=projects.findIndex(project=>project.slug===match[1]);return{work:true,index};}
  return{work:/^\/work\/?$/.test(pathname),index:-1};
}

export function projectProgress(index,count,mobile=false){
  const value=count>1?index/(count-1):0;
  let low=0,high=1;
  for(let i=0;i<48;i++){const t=(low+high)/2;if(t*t*(3-2*t)<value)low=t;else high=t;}
  const offset=mobile?.1:.06;
  return offset+(1-2*offset)*(low+high)/2;
}
