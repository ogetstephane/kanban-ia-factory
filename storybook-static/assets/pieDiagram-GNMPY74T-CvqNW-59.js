import{n as e}from"./rolldown-runtime-sJBDdmOt.js";import{n as t,r as n}from"./mermaid-parser.core-BIFBammC.js";import{n as r,r as i}from"./chunk-Y2CYZVJY-BLgfQGNL.js";import{N as a,P as o,_ as s,t as c,v as l}from"./src-D2IjgwFm.js";import{A as u,C as d,J as f,U as p,W as m,_ as h,a as g,b as _,c as v,f as y,v as b}from"./chunk-DSNLSHJZ-DvMsrR-b.js";import{Yn as x}from"./noop-C_4mPdsr.js";import{n as S,t as C}from"./chunk-JWPE2WC7-CUwS0ygC.js";import{f as w,h as T,i as E}from"./chunk-7S6XSTFO-DBjO3cEG.js";import{l as D,u as O}from"./mermaid.core-DqhCJD3d.js";var k,A,j,M,N,P,F,I,L,R,z;function B(){return(B=e((()=>{C(),D(),w(),u(),a(),i(),t(),c(),k=y.pie,A={sections:new Map,showData:!1,config:k},j=A.sections,M=A.showData,N=structuredClone(k),P={getConfig:r(()=>structuredClone(N),`getConfig`),clear:r(()=>{j=new Map,M=A.showData,g()},`clear`),setDiagramTitle:f,getDiagramTitle:d,setAccTitle:m,getAccTitle:b,setAccDescription:p,getAccDescription:h,addSection:r(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);j.has(e)||(j.set(e,t),o.debug(`added new section: ${e}, with value: ${t}`))},`addSection`),getSections:r(()=>j,`getSections`),setShowData:r(e=>{M=e},`setShowData`),getShowData:r(()=>M,`getShowData`)},F=r((e,t)=>{S(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),I={parse:r(async e=>{let t=await n(`pie`,e);o.debug(t),F(t,P)},`parse`)},L=r(e=>`
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
`,`getStyles`),R=r(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return s().value(e=>e.value).sort(null)(n)},`createPieArcs`),z={parser:I,db:P,renderer:{draw:r((e,t,n,r)=>{o.debug(`rendering pie chart
`+e);let i=r.db,a=_(),s=E(i.getConfig(),a.pie),c=O(t),u=c.append(`g`);u.attr(`transform`,`translate(225,225)`);let{themeVariables:d}=a,[f]=T(d.pieOuterStrokeWidth);f??=2;let p=s.legendPosition,m=s.textPosition,h=s.donutHole>0&&s.donutHole<=.9?s.donutHole:0,g=l().innerRadius(h*185).outerRadius(185),y=l().innerRadius(185*m).outerRadius(185*m),b=u.append(`g`);b.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+f/2).attr(`class`,`pieOuterCircle`);let S=i.getSections(),C=R(S),w=[d.pie1,d.pie2,d.pie3,d.pie4,d.pie5,d.pie6,d.pie7,d.pie8,d.pie9,d.pie10,d.pie11,d.pie12],D=0;S.forEach(e=>{D+=e});let k=C.filter(e=>(e.data.value/D*100).toFixed(0)!==`0`),A=x(w).domain([...S.keys()]);b.selectAll(`mySlices`).data(k).enter().append(`path`).attr(`d`,g).attr(`fill`,e=>A(e.data.label)).attr(`class`,e=>{let t=`pieCircle`;return s.highlightSlice===`hover`?t+=` highlightedOnHover`:s.highlightSlice===e.data.label&&(t+=` highlighted`),t}),b.selectAll(`mySlices`).data(k).enter().append(`text`).text(e=>(e.data.value/D*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+y.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let j=u.append(`text`).text(i.getDiagramTitle()).attr(`x`,0).attr(`y`,-200).attr(`class`,`pieTitleText`),M=[...S.entries()].map(([e,t])=>({label:e,value:t})),N=u.selectAll(`.legend`).data(M).enter().append(`g`).attr(`class`,`legend`);N.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>A(e.label)).style(`stroke`,e=>A(e.label)),N.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>i.getShowData()?`${e.label} [${e.value}]`:e.label);let P=Math.max(...N.selectAll(`text`).nodes().map(e=>e?.getBoundingClientRect().width??0)),F=450,I=490,L=M.length*22;switch(p){case`center`:N.attr(`transform`,(e,t)=>{let n=22*M.length/2,r=-P/2-22,i=t*22-n;return`translate(`+r+`,`+i+`)`});break;case`top`:F+=L,N.attr(`transform`,(e,t)=>`translate(${-P/2-22}, ${t*22-185})`),b.attr(`transform`,()=>`translate(0, ${L+22})`);break;case`bottom`:F+=L,N.attr(`transform`,(e,t)=>{let n=-P/2-22,r=t*22- -207;return`translate(`+n+`,`+r+`)`});break;case`left`:I+=22+P,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(-207,`+(t*22-n)+`)`}),b.attr(`transform`,()=>`translate(${P+18+4}, 0)`);break;default:I+=22+P,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(216,`+(t*22-n)+`)`})}let z=j.node()?.getBoundingClientRect().width??0,B=225-z/2,V=225+z/2,H=Math.min(0,B),U=Math.max(I,V)-H;c.attr(`viewBox`,`${H} 0 ${U} ${F}`),v(c,F,U,s.useMaxWidth)},`draw`)},styles:L}})))()}B();export{z as diagram};