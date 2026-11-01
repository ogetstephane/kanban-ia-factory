import{t as e}from"./arc-DztT0aE2.js";import{i as t,m as n}from"./chunk-7S6XSTFO-BRvbyv_0.js";import{n as r}from"./src-UPUUL7p8.js";import{Dt as i,Ht as a,Vt as o,j as s}from"./index-Cqu6Cm6Y.js";import{n as c}from"./mermaid-parser.core-D_7voJUs.js";import{n as l}from"./chunk-Y2CYZVJY-DsF7k-Jl.js";import{C as u,H as d,U as f,_ as p,a as m,b as h,c as g,f as _,q as v,v as y}from"./chunk-DSNLSHJZ-jUpIaTbh.js";import{t as b}from"./chunk-JWPE2WC7-DVXcaiue.js";import{a as x}from"./mermaid.core-BIdRYDnp.js";function S(e,t){return t<e?-1:t>e?1:t>=e?0:NaN}function C(e){return e}function w(){var e=C,t=S,n=null,r=a(0),s=a(o),c=a(0);function l(a){var l,u=(a=i(a)).length,d,f,p=0,m=Array(u),h=Array(u),g=+r.apply(this,arguments),_=Math.min(o,Math.max(-o,s.apply(this,arguments)-g)),v,y=Math.min(Math.abs(_)/u,c.apply(this,arguments)),b=y*(_<0?-1:1),x;for(l=0;l<u;++l)(x=h[m[l]=l]=+e(a[l],l,a))>0&&(p+=x);for(t==null?n!=null&&m.sort(function(e,t){return n(a[e],a[t])}):m.sort(function(e,n){return t(h[e],h[n])}),l=0,f=p?(_-u*b)/p:0;l<u;++l,g=v)d=m[l],x=h[d],v=g+(x>0?x*f:0)+b,h[d]={data:a[d],index:l,value:x,startAngle:g,endAngle:v,padAngle:y};return h}return l.value=function(t){return arguments.length?(e=typeof t==`function`?t:a(+t),l):e},l.sortValues=function(e){return arguments.length?(t=e,n=null,l):t},l.sort=function(e){return arguments.length?(n=e,t=null,l):n},l.startAngle=function(e){return arguments.length?(r=typeof e==`function`?e:a(+e),l):r},l.endAngle=function(e){return arguments.length?(s=typeof e==`function`?e:a(+e),l):s},l.padAngle=function(e){return arguments.length?(c=typeof e==`function`?e:a(+e),l):c},l}var T=_.pie,E={sections:new Map,showData:!1,config:T},D=E.sections,O=E.showData,k=structuredClone(T),A={getConfig:l(()=>structuredClone(k),`getConfig`),clear:l(()=>{D=new Map,O=E.showData,m()},`clear`),setDiagramTitle:v,getDiagramTitle:u,setAccTitle:f,getAccTitle:y,setAccDescription:d,getAccDescription:p,addSection:l(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);D.has(e)||(D.set(e,t),r.debug(`added new section: ${e}, with value: ${t}`))},`addSection`),getSections:l(()=>D,`getSections`),setShowData:l(e=>{O=e},`setShowData`),getShowData:l(()=>O,`getShowData`)},j=l((e,t)=>{b(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),M={parse:l(async e=>{let t=await c(`pie`,e);r.debug(t),j(t,A)},`parse`)},N=l(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`),P=l(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return w().value(e=>e.value).sort(null)(n)},`createPieArcs`),F={parser:M,db:A,renderer:{draw:l((i,a,o,c)=>{r.debug(`rendering pie chart
`+i);let l=c.db,u=h(),d=t(l.getConfig(),u.pie),f=x(a),p=f.append(`g`);p.attr(`transform`,`translate(225,225)`);let{themeVariables:m}=u,[_]=n(m.pieOuterStrokeWidth);_??=2;let v=d.legendPosition,y=d.textPosition,b=d.donutHole>0&&d.donutHole<=.9?d.donutHole:0,S=e().innerRadius(b*185).outerRadius(185),C=e().innerRadius(185*y).outerRadius(185*y),w=p.append(`g`);w.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+_/2).attr(`class`,`pieOuterCircle`);let T=l.getSections(),E=P(T),D=[m.pie1,m.pie2,m.pie3,m.pie4,m.pie5,m.pie6,m.pie7,m.pie8,m.pie9,m.pie10,m.pie11,m.pie12],O=0;T.forEach(e=>{O+=e});let k=E.filter(e=>(e.data.value/O*100).toFixed(0)!==`0`),A=s(D).domain([...T.keys()]);w.selectAll(`mySlices`).data(k).enter().append(`path`).attr(`d`,S).attr(`fill`,e=>A(e.data.label)).attr(`class`,e=>{let t=`pieCircle`;return d.highlightSlice===`hover`?t+=` highlightedOnHover`:d.highlightSlice===e.data.label&&(t+=` highlighted`),t}),w.selectAll(`mySlices`).data(k).enter().append(`text`).text(e=>(e.data.value/O*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+C.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let j=p.append(`text`).text(l.getDiagramTitle()).attr(`x`,0).attr(`y`,-200).attr(`class`,`pieTitleText`),M=[...T.entries()].map(([e,t])=>({label:e,value:t})),N=p.selectAll(`.legend`).data(M).enter().append(`g`).attr(`class`,`legend`);N.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>A(e.label)).style(`stroke`,e=>A(e.label)),N.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>l.getShowData()?`${e.label} [${e.value}]`:e.label);let F=Math.max(...N.selectAll(`text`).nodes().map(e=>e?.getBoundingClientRect().width??0)),I=450,L=490,R=M.length*22;switch(v){case`center`:N.attr(`transform`,(e,t)=>{let n=22*M.length/2,r=-F/2-22,i=t*22-n;return`translate(`+r+`,`+i+`)`});break;case`top`:I+=R,N.attr(`transform`,(e,t)=>`translate(${-F/2-22}, ${t*22-185})`),w.attr(`transform`,()=>`translate(0, ${R+22})`);break;case`bottom`:I+=R,N.attr(`transform`,(e,t)=>{let n=-F/2-22,r=t*22- -207;return`translate(`+n+`,`+r+`)`});break;case`left`:L+=22+F,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(-207,`+(t*22-n)+`)`}),w.attr(`transform`,()=>`translate(${F+18+4}, 0)`);break;default:L+=22+F,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(216,`+(t*22-n)+`)`})}let z=j.node()?.getBoundingClientRect().width??0,B=225-z/2,V=225+z/2,H=Math.min(0,B),U=Math.max(L,V)-H;f.attr(`viewBox`,`${H} 0 ${U} ${I}`),g(f,I,U,d.useMaxWidth)},`draw`)},styles:N};export{F as diagram};