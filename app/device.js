export function deviceProfile() {
  let explicit=null;
  
  const mobile=explicit==='phone'||explicit==='tablet'||navigator.maxTouchPoints>0||/android|iphone|ipad|mobile/i.test(navigator.userAgent);
  const phone=explicit==='phone'||(explicit!=='tablet'&&mobile&&Math.min(innerWidth,innerHeight)<700);
  return{mobile,phone,portrait:mobile&&innerHeight>innerWidth};
}
