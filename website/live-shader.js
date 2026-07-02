// Live wallpaper backdrop — the real thing.
//
// This is a vanilla-JS port of the app's WebGL2 live-shader engine
// (src/lib/shaders.ts + liveShader.ts): the SAME GLSL fragment shaders the
// desktop app runs as live wallpapers, rendered full-bleed behind the whole
// site so the homepage literally *is* a live wallpaper. It autoplays through
// a curated set of patterns, crossfades on switch, and publishes each one's
// tint onto :root so every liquid-glass surface re-tints to match.
//
// Progressive enhancement: if WebGL2 is unavailable or the visitor prefers
// reduced motion, this bails and the static CSS backdrop (wallpapers.js)
// shows instead — so the page is never blank and never forces motion.

(function () {
  'use strict';

  var reduce =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- GLSL (verbatim from the app's shaders.ts) --------------------

  var VERT =
    '#version 300 es\n' +
    'in vec2 a_pos;\n' +
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }\n';

  var HEAD =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 u_resolution;\n' +
    'uniform float u_time;\n' +
    'uniform vec3 u_colors[8];\n' +
    'uniform int u_colorCount;\n' +
    'uniform float u_seed;\n' +
    'uniform float u_size;\n' +
    'uniform float u_p1;\n' +
    'uniform float u_p2;\n' +
    'uniform float u_p3;\n' +
    'out vec4 fragColor;\n' +
    'const float TWO_PI = 6.28318530718;\n' +
    'uniform vec4 u_t0;\n' +
    'uniform vec4 u_t1;\n' +
    'uniform vec4 u_t2;\n' +
    'uniform vec4 u_t3;\n' +
    'float hash(float n){return fract(sin(n*12.9898+u_seed*0.013)*43758.5453123);}\n' +
    'float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+u_seed*0.013)*43758.5453);}\n' +
    'vec3 paletteColor(int i){int plen=u_colorCount-1;if(plen<1)return u_colors[0];int idx=i-(i/plen)*plen;return u_colors[1+idx];}\n';

  var AURORA =
    'const float SPEED=0.20;void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 p=vec2(gl_FragCoord.x,h-gl_FragCoord.y);float v=p.y/h;' +
    'int bands=int(max(u_p1,2.0));float bandsF=float(bands);float spread=clamp(u_p3,0.0,1.0);float amp=clamp(u_p2,0.0,1.0);float curtainW=w*(0.05+spread*0.15);float sway=amp*w*0.1;float gphase=hash(1.0)*TWO_PI;vec3 col=u_colors[0];' +
    'for(int band=0;band<16;band++){if(band>=bands)break;float fb=float(band);float bx=(fb+0.5)/bandsF*w+(hash(fb+2.0)-0.5)*(w/bandsF)*0.5;float depth=bandsF>1.0?fb/(bandsF-1.0):0.5;float phase=gphase+fb*0.9+u_time*SPEED*mix(0.45,1.3,depth);float hw=curtainW*(0.6+hash(fb+9.0)*0.7)*0.5;float cx=bx+sway*(sin(phase+v*1.6*TWO_PI)+0.4*sin(phase*1.9+v*TWO_PI));float dx=abs(p.x-cx);float hf=1.0-smoothstep(hw*0.25,hw,dx);float va;if(v<0.45)va=mix(0.0,0.75,v/0.45);else if(v<0.75)va=mix(0.75,0.5,(v-0.45)/0.30);else va=mix(0.5,0.0,(v-0.75)/0.25);col=mix(col,paletteColor(band),va*hf);}' +
    'fragColor=vec4(col,1.0);}';

  var FLOW =
    'const float SPEED=0.22;void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 p=vec2(gl_FragCoord.x,h-gl_FragCoord.y);float u=p.x/w;' +
    'float scale=max(w,h)/1920.0;float thickness=max(u_size*scale*0.12,1.0);float cycles=0.5+clamp(u_p3,0.0,1.0)*2.5;float ampPx=clamp(u_p2,0.0,1.0)*h*0.16;int lines=int(max(u_p1,1.0));float linesF=float(lines);float gphase=hash(1.0)*TWO_PI;vec3 col=u_colors[0];' +
    'for(int i=0;i<128;i++){if(i>=lines)break;float li=float(i);float baseline=(li+0.5)/linesF*h;float depth=(li+0.5)/linesF;float phase=gphase+li*0.22+u_time*SPEED*mix(0.45,1.3,depth);float ampI=ampPx*(0.8+hash(li+3.0)*0.4);float a=sin(phase+u*cycles*TWO_PI);float b=sin(phase*1.7+u*cycles*1.9*TWO_PI);float wy=baseline+ampI*(a+0.4*b)*0.7;float d=abs(p.y-wy);float aa=1.0-smoothstep(thickness*0.5-1.0,thickness*0.5+1.0,d);if(aa>0.0){vec3 lc=mix(paletteColor(i),paletteColor(i+1),u);col=mix(col,lc,aa*0.7);}}' +
    'fragColor=vec4(col,1.0);}';

  var WAVES =
    'const float SPEED=0.16;void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 p=vec2(gl_FragCoord.x,h-gl_FragCoord.y);float u=p.x/w;' +
    'float cycles=0.5+clamp(u_p3,0.0,1.0)*2.5;float ampPx=clamp(u_p2,0.0,1.0)*h*0.11;int layers=int(max(u_p1,2.0));float gphase=hash(1.0)*TWO_PI;vec3 col=u_colors[0];' +
    'for(int layer=0;layer<24;layer++){if(layer>=layers)break;float t=layers>1?float(layer)/float(layers-1):0.5;float baseline=h*(0.12+t*0.78);float phase=gphase+float(layer)*0.7+u_time*SPEED*mix(0.45,1.3,t);float ampL=ampPx*(0.6+hash(float(layer)+5.0)*0.6);float a=sin(phase+u*cycles*TWO_PI);float b=sin(phase*1.6+u*cycles*2.1*TWO_PI);float wy=baseline+ampL*(a+0.35*b);float cover=smoothstep(wy-1.0,wy+1.0,p.y);if(cover>0.0){float gtop=baseline-ampL;float tg=clamp((p.y-gtop)/max(h-gtop,1.0),0.0,1.0);vec3 lc=mix(paletteColor(layer),paletteColor(layer+1),tg);col=mix(col,lc,cover);}}' +
    'fragColor=vec4(col,1.0);}';

  var BOKEH =
    'void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 frag=vec2(gl_FragCoord.x,h-gl_FragCoord.y);' +
    'float scale=max(w,h)/1920.0;int count=int(clamp(u_p1,4.0,64.0));float baseR=max(u_size*scale*2.2,8.0);float minDim=min(w,h);vec3 col=u_colors[0];' +
    'for(int i=0;i<64;i++){if(i>=count)break;float fi=float(i)+1.0;float hx=hash(fi*2.0);float hy=hash(fi*2.0+1.0);float hr=hash(fi+19.0);float ha=hash(fi+41.0);float hs=hash(fi+7.0);float hf=hash(fi+23.0);float hsp=hash(fi+53.0);' +
    'float rad=baseR*mix(0.4,1.5,hr);float riseSpeed=minDim*(0.018+hs*0.05);float span=h+2.0*rad;float cy=mod(hy*h-u_time*riseSpeed,span)-rad;float swirlAmp=rad*mix(0.3,1.0,hf);float swirlFreq=0.3+hsp*0.6;float cx=hx*w+swirlAmp*sin(u_time*swirlFreq+hsp*TWO_PI);vec2 center=vec2(cx,cy);float dd=distance(frag,center)/max(rad,1.0);float core=mix(0.45,1.0,smoothstep(0.0,0.72,dd));float edge=1.0-smoothstep(0.86,1.0,dd);float a=core*edge*mix(0.16,0.5,ha);if(a<=0.0)continue;col=mix(col,paletteColor(i),a);}' +
    'fragColor=vec4(col,1.0);}';

  var FLOWER_HELPERS =
    'const float PI=3.14159265359;vec3 paletteRing(float pos){int plen=u_colorCount-1;if(plen<1)return u_colors[0];float fp=float(plen);float pp=pos-fp*floor(pos/fp);int i0=int(pp);int i1=i0+1;if(i1>=plen)i1=0;return mix(u_colors[1+i0],u_colors[1+i1],pp-float(i0));}vec3 drawLayer(vec3 col,vec2 frag,vec2 center,float petals,float r0,float len,float hw,float rot,float alpha){vec2 d=frag-center;float ang=atan(d.y,d.x);float rho=length(d);float seg=TWO_PI/petals;float baseIdx=floor((ang-rot)/seg+0.5);float colorsPerRev=float(max(u_colorCount-1,1));for(int k=-1;k<=1;k++){float pk=baseIdx+float(k);float la=ang-(rot+pk*seg);la=atan(sin(la),cos(la));float along=rho*cos(la);float lat=rho*sin(la);float u=(along-r0)/len;float uc=clamp(u,0.0,1.0);float wlat=hw*pow(max(sin(PI*uc),0.0),0.55);float latd=abs(lat);float aaLat=clamp(fwidth(latd),1.0,4.0);float cov=(1.0-smoothstep(wlat-aaLat,wlat+aaLat,latd))*step(0.0,u)*step(u,1.0);float pidx=pk-petals*floor(pk/petals);float cpos=(pidx/petals)*colorsPerRev;float cspan=colorsPerRev/petals;vec3 pcol=paletteRing(cpos+uc*cspan);float rimW=aaLat*2.0+wlat*0.10;float rim=smoothstep(wlat-rimW,wlat,latd);float plum=dot(pcol,vec3(0.299,0.587,0.114));vec3 edgeCol=clamp(mix(vec3(plum),pcol,1.3),0.0,1.0)*0.6;pcol=mix(pcol,edgeCol,rim*0.85);col=mix(col,pcol,alpha*cov);}return col;}';

  var FLOWER =
    'void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 frag=vec2(gl_FragCoord.x,h-gl_FragCoord.y);float minDim=min(w,h);' +
    'float petals=clamp(u_p1,3.0,64.0);float twist=clamp(u_p2,0.0,1.0);float sizeScale=max(u_size,10.0)/100.0;vec2 center=vec2(w*0.5,h*0.5);float baseR=minDim*0.02;float reach=min(minDim*0.5*sizeScale,minDim*0.46);float globalRot=hash(3.0)*TWO_PI;float hwFactor=mix(0.95,1.4,twist);vec3 col=u_colors[0];' +
    'float cpr=float(max(u_colorCount-1,1));float glowR=reach*0.5;float gt=clamp(distance(frag,center)/max(glowR,1.0),0.0,1.0);col=mix(col,paletteRing(0.0),0.5*pow(1.0-gt,1.6));float len0=reach;float len1=reach*0.62;float hw0=len0*sin(PI/petals)*hwFactor;float hw1=len1*sin(PI/petals)*hwFactor;col=drawLayer(col,frag,center,petals,baseR,len0,hw0,globalRot+u_time*0.10,1.0);col=drawLayer(col,frag,center,petals,baseR,len1,hw1,globalRot+PI/petals-u_time*0.14,1.0);float cr=reach*0.10;col=mix(col,paletteRing(cpr*0.5),1.0-smoothstep(cr*0.7,cr,distance(frag,center)));' +
    'fragColor=vec4(col,1.0);}';

  // Matrix digital rain — same baked 5x7 glyph font as the app (see
  // src/lib/shaders.ts MATRIX_MAIN; regenerate together).
  var MATRIX =
    'const int FONT_N=88;\n' +
    'const uvec2 FONT[88] = uvec2[88](uvec2(71447071u, 2u), uvec2(102672u, 0u), uvec2(285788132u, 6u), uvec2(138547359u, 31u), uvec2(312882120u, 12u), uvec2(623530948u, 25u), uvec2(142479812u, 4u), uvec2(142920644u, 2u), uvec2(138718146u, 2u), uvec2(554189343u, 31u), uvec2(277162314u, 4u), uvec2(143148034u, 2u), uvec2(616702238u, 17u), uvec2(69564994u, 28u), uvec2(142887473u, 2u), uvec2(143051716u, 2u), uvec2(138547342u, 2u), uvec2(142886564u, 2u), uvec2(138574862u, 2u), uvec2(35030049u, 1u), uvec2(4357252u, 2u), uvec2(14u, 31u), uvec2(751184414u, 3u), uvec2(141697476u, 4u), uvec2(138682896u, 3u), uvec2(587802954u, 17u), uvec2(34649121u, 31u), uvec2(142885407u, 2u), uvec2(538224838u, 16u), uvec2(726798788u, 4u), uvec2(138748447u, 8u), uvec2(101059086u, 8u), uvec2(1009059844u, 17u), uvec2(616966416u, 1u), uvec2(139432078u, 28u), uvec2(138829634u, 4u), uvec2(277094670u, 31u), uvec2(554648095u, 31u), uvec2(277380110u, 6u), uvec2(285787697u, 4u), uvec2(191043782u, 13u), uvec2(177767457u, 3u), uvec2(588826175u, 17u), uvec2(277366335u, 6u), uvec2(142622785u, 3u), uvec2(588826158u, 14u), uvec2(138547334u, 31u), uvec2(209994254u, 31u), uvec2(554058254u, 31u), uvec2(301279624u, 8u), uvec2(554186830u, 15u), uvec2(589136958u, 14u), uvec2(138551583u, 4u), uvec2(588728878u, 30u), uvec2(558679598u, 15u), uvec2(585443460u, 17u), uvec2(588752431u, 15u), uvec2(34636862u, 30u), uvec2(588826159u, 15u), uvec2(35095615u, 31u), uvec2(35095615u, 1u), uvec2(589071422u, 30u), uvec2(589284913u, 17u), uvec2(1073741823u, 31u), uvec2(554189328u, 31u), uvec2(311661881u, 17u), uvec2(34636833u, 31u), uvec2(725478961u, 17u), uvec2(865783409u, 17u), uvec2(588826158u, 14u), uvec2(35112511u, 1u), uvec2(488162862u, 24u), uvec2(307742255u, 17u), uvec2(554044462u, 31u), uvec2(138547359u, 4u), uvec2(588826161u, 14u), uvec2(145031729u, 4u), uvec2(344512165u, 10u), uvec2(346175825u, 17u), uvec2(138553361u, 4u), uvec2(69345566u, 31u), uvec2(414u, 30u), uvec2(408983952u, 16u), uvec2(214446273u, 1u), uvec2(350745732u, 10u), uvec2(139432068u, 4u), uvec2(31u, 31u), uvec2(1073741823u, 31u));\n' +
    'float glyphPx(int idx,int col,int row){uvec2 g=FONT[idx-(idx/FONT_N)*FONT_N];uint bits=(row<6)?(g.x>>uint(row*5)):g.y;return float((bits>>uint(col))&1u);}\n' +
    'void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 frag=vec2(gl_FragCoord.x,h-gl_FragCoord.y);' +
    'float cols=max(u_p1,8.0);float trail=mix(5.0,30.0,clamp(u_p2,0.0,1.0));float speedK=mix(0.25,1.6,clamp(u_p3,0.0,1.0));' +
    'float cellW=w/cols;float cellH=cellW*1.5;vec2 cell=vec2(cellW,cellH);vec2 gid=floor(frag/cell);float rows=h/cellH;' +
    'float colR=hash(gid.x*7.31);float speed=(2.0+colR*6.0)*speedK;float offset=hash(gid.x*13.7)*977.0;' +
    'float cycle=rows+trail;float head=mod(u_time*speed+offset,cycle);float age=head-gid.y;float bright=(age>=0.0)?clamp(1.0-age/trail,0.0,1.0):0.0;bright*=bright;' +
    'int textCount=int(u_t3.w+0.5);int idx;' +
    'if(textCount>0){int slot=int(mod(gid.y+floor(offset),float(textCount)));float v=(slot<4)?u_t0[slot]:(slot<8)?u_t1[slot-4]:(slot<12)?u_t2[slot-8]:u_t3[slot-12];idx=int(v+0.5);}' +
    'else{float tick=floor(u_time*(0.5+hash21(gid)*2.5));idx=int(hash21(gid*3.17+tick*0.618)*float(FONT_N));}' +
    'vec2 f=fract(frag/cell);vec2 sub=floor(f*vec2(6.0,8.0));float lit=0.0;' +
    'if(sub.x<5.0&&sub.y<7.0){lit=glyphPx(idx,int(sub.x),int(sub.y));}' +
    'vec3 rain=paletteColor(int(colR*101.0));float headGlow=step(age,1.0)*step(0.0,age);vec3 glyph=mix(rain,vec3(1.0),headGlow*0.75);' +
    'vec3 col=mix(u_colors[0],glyph,bright*lit);fragColor=vec4(col,1.0);}';

  // CRT test card — SMPTE bars + curvature, scanlines, hum bar, static
  // bursts, mains flicker, H-sync tears (see shaders.ts CRT_MAIN).
  var CRT =
    'vec3 smpteBar(float u){int i=int(clamp(u,0.0,0.999)*7.0);if(i==0)return vec3(0.75,0.75,0.75);if(i==1)return vec3(0.75,0.75,0.0);if(i==2)return vec3(0.0,0.75,0.75);if(i==3)return vec3(0.0,0.75,0.0);if(i==4)return vec3(0.75,0.0,0.75);if(i==5)return vec3(0.75,0.0,0.0);return vec3(0.0,0.0,0.75);}\n' +
    'vec3 castellation(float u){int i=int(clamp(u,0.0,0.999)*7.0);if(i==0)return vec3(0.0,0.0,0.75);if(i==2)return vec3(0.75,0.0,0.75);if(i==4)return vec3(0.0,0.75,0.75);if(i==6)return vec3(0.75,0.75,0.75);return vec3(0.0);}\n' +
    'vec3 bottomStrip(float u){if(u<0.125)return vec3(0.0,0.129,0.298);if(u<0.25)return vec3(1.0);if(u<0.375)return vec3(0.192,0.0,0.42);if(u<0.625)return vec3(0.0);if(u<0.708)return vec3(0.015);if(u<0.791)return vec3(0.045);if(u<0.875)return vec3(0.09);return vec3(0.0);}\n' +
    'void main(){float w=u_resolution.x;float h=u_resolution.y;vec2 frag=vec2(gl_FragCoord.x,h-gl_FragCoord.y);vec2 uv=frag/vec2(w,h);' +
    'float curv=clamp(u_p2,0.0,1.0);vec2 cc=uv*2.0-1.0;cc*=1.0+curv*0.16*dot(cc,cc);uv=(cc+1.0)*0.5;' +
    'if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){fragColor=vec4(u_colors[0]*0.25,1.0);return;}' +
    'float burst=hash(floor(u_time*0.5)+31.0);float burstOn=step(0.72,burst)*step(fract(u_time*0.5),0.12);float shear=burstOn*(hash21(vec2(floor(uv.y*90.0),floor(u_time*24.0)))-0.5)*0.06;uv.x=clamp(uv.x+shear,0.0,1.0);' +
    'vec3 col;if(uv.y<0.67){col=smpteBar(uv.x);}else if(uv.y<0.75){col=castellation(uv.x);}else{col=bottomStrip(uv.x);}' +
    'float scanStrength=clamp(u_p1,0.0,1.0);float scan=1.0-scanStrength*0.3*(0.5+0.5*sin(frag.y*3.14159));' +
    'float band=fract(uv.y*0.9-u_time*0.11);float roll=1.0+0.10*exp(-pow((band-0.5)*6.0,2.0))+0.03*sin(TWO_PI*(uv.y*1.4-u_time*0.16));' +
    'float noiseAmt=clamp(u_p3,0.0,1.0);float staticBand=exp(-pow((fract(uv.y+u_time*0.043)-0.5)*10.0,2.0));float n=(hash21(frag+fract(u_time)*vec2(917.3,113.7))-0.5)*noiseAmt*(0.16+staticBand*0.5);' +
    'float flicker=1.0+0.02*sin(u_time*47.0)+0.012*sin(u_time*13.7);float vig=1.0-(0.15+curv*0.25)*dot(cc,cc);' +
    'col=col*scan*roll*vig*flicker+n;fragColor=vec4(col,1.0);}';

  var FRAG = {
    aurora: HEAD + AURORA,
    flow: HEAD + FLOW,
    waves: HEAD + WAVES,
    bokeh: HEAD + BOKEH,
    flower: HEAD + FLOWER_HELPERS + FLOWER,
    matrix: HEAD + MATRIX,
    crt: HEAD + CRT,
  };

  // Matrix charset — index order matches the baked FONT (mirrors
  // MATRIX_CHARSET in src/lib/shaders.ts).
  var MATRIX_CHARSET =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:<>*+=-';
  function matrixSlots(text) {
    var out = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    var n = 0;
    var chars = (text || '').toUpperCase();
    for (var i = 0; i < chars.length && n < 15; i++) {
      var idx = MATRIX_CHARSET.indexOf(chars.charAt(i));
      if (idx >= 0) out[n++] = idx;
    }
    out[15] = n;
    return out;
  }

  // ---- curated presets (palette + type + knobs) ---------------------
  // base is u_colors[0] (background); colors[] are the foreground palette.
  // knobs: [p1, p2, p3] meaning per type (see shaders.ts header).

  var PRESETS = [
    { name: 'Aurora', type: 'aurora', tint: [94, 234, 212], size: 80,
      base: '#04130f', colors: ['#5eead4', '#34d399', '#818cf8', '#22d3ee', '#c4b5fd'], p: [6, 0.55, 0.6] },
    { name: 'Silk', type: 'waves', tint: [56, 189, 248], size: 80,
      base: '#04141d', colors: ['#38bdf8', '#0ea5e9', '#22d3ee', '#2563eb', '#67e8f9'], p: [9, 0.62, 0.5] },
    { name: 'Ember', type: 'flow', tint: [248, 113, 113], size: 90,
      base: '#170707', colors: ['#f87171', '#fb923c', '#fbbf24', '#ef4444'], p: [7, 0.6, 0.5] },
    { name: 'Bloom', type: 'flower', tint: [244, 114, 182], size: 92,
      base: '#160a18', colors: ['#f472b6', '#a78bfa', '#fbbf24', '#fb7185'], p: [8, 0.6, 0] },
    { name: 'Bokeh', type: 'bokeh', tint: [129, 140, 248], size: 70,
      base: '#0a0a1f', colors: ['#818cf8', '#c4b5fd', '#f472b6', '#67e8f9', '#fcd34d'], p: [30, 0, 0] },
    { name: 'Forest', type: 'waves', tint: [52, 211, 153], size: 80,
      base: '#06140e', colors: ['#34d399', '#10b981', '#a3e635', '#14b8a6', '#86efac'], p: [8, 0.55, 0.45] },
    { name: 'Tide', type: 'aurora', tint: [56, 189, 248], size: 80,
      base: '#04141d', colors: ['#38bdf8', '#22d3ee', '#67e8f9', '#2563eb', '#a5f3fc'], p: [7, 0.6, 0.5] },
    // New in 1.3 — the Matrix rains the app's name; the CRT card hums.
    { name: 'Matrix', type: 'matrix', tint: [61, 214, 140], size: 80,
      base: '#04120a', colors: ['#3dd68c', '#a3f7bf', '#1f8a5b'], p: [42, 0.55, 0.45], text: 'AMBIENT' },
    { name: 'CRT Test', type: 'crt', tint: [148, 163, 184], size: 80,
      base: '#000000', colors: ['#94a3b8'], p: [0.6, 0.35, 0.3] },
    // Emoji isn't a shader — rendered as a drifting tiled DOM layer (see
    // buildEmoji / the #wp-emoji crossfade), so the live backdrop showcases
    // the app's emoji walls too, not just the generative shaders.
    { name: 'Blossom', type: 'emoji', tint: [244, 114, 182],
      base: '#160a18', colors: ['#f472b6', '#a78bfa'], emojis: ['🌸', '🌷', '✨'] },
    { name: 'Cosmos', type: 'emoji', tint: [124, 92, 255],
      base: '#0a0a1f', colors: ['#7c5cff', '#5b8cff'], emojis: ['🌟', '🌙', '💫'] },
  ];

  function hexRgb(hex) {
    var h = hex.replace('#', '');
    return [
      parseInt(h.substr(0, 2), 16) / 255,
      parseInt(h.substr(2, 2), 16) / 255,
      parseInt(h.substr(4, 2), 16) / 255,
    ];
  }

  // ---- engine -------------------------------------------------------

  function start() {
    var backdrop = document.getElementById('wp-backdrop');
    if (!backdrop) return false;

    var canvas = document.createElement('canvas');
    canvas.id = 'wp-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) return false; // no WebGL2 → leave the CSS backdrop in place

    backdrop.appendChild(canvas);
    // Signal the static engine to stand down — the live canvas owns the
    // backdrop + the prev/next arrows now.
    window.__AMBIENT_LIVE__ = true;

    // Emoji preset layer: emoji isn't a shader, so emoji presets render here
    // (tiled emoji wall over colour blobs) and go() crossfades it with the GL
    // canvas. Mirrors wallpapers.js's emoji() look.
    var emojiLayer = document.createElement('div');
    emojiLayer.id = 'wp-emoji';
    emojiLayer.setAttribute('aria-hidden', 'true');
    backdrop.appendChild(emojiLayer);

    function rgba(hex, a) {
      var h = hex.replace('#', '');
      return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) +
        ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')';
    }
    function buildEmoji(wp) {
      var e = wp.emojis || ['✨', '🌙', '💫'];
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
        '<text x="38" y="52" font-size="42" text-anchor="middle" transform="rotate(-12 38 42)">' + e[0] + '</text>' +
        '<text x="112" y="64" font-size="40" text-anchor="middle" transform="rotate(10 112 54)">' + (e[1] || e[0]) + '</text>' +
        '<text x="78" y="120" font-size="44" text-anchor="middle" transform="rotate(-6 78 110)">' + (e[2] || e[0]) + '</text>' +
        '</svg>';
      emojiLayer.style.backgroundColor = wp.base;
      emojiLayer.style.backgroundImage = [
        'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")',
        'radial-gradient(70% 70% at 28% 24%, ' + rgba(wp.colors[0], 0.55) + ' 0%, transparent 72%)',
        'radial-gradient(70% 70% at 82% 84%, ' + rgba(wp.colors[1] || wp.colors[0], 0.5) + ' 0%, transparent 72%)',
      ].join(', ');
      emojiLayer.style.backgroundSize = '168px 168px, auto, auto';
    }

    var MAX_DIM = 2200; // cap internal resolution for fill-rate
    var MIN_FRAME_MS = 1000 / 32; // ~32fps is plenty for a background

    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    var program = null;
    var activeType = null;
    var u = {};
    var colorBuf = new Float32Array(8 * 3);
    var UNI = ['u_resolution', 'u_time', 'u_colors', 'u_colorCount', 'u_seed', 'u_size', 'u_p1', 'u_p2', 'u_p3', 'u_t0', 'u_t1', 'u_t2', 'u_t3'];

    function compile(kind, src) {
      var s = gl.createShader(kind);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('compile: ' + log);
      }
      return s;
    }

    function buildProgram(type) {
      var frag = FRAG[type];
      if (!frag) return false;
      var vs = compile(gl.VERTEX_SHADER, VERT);
      var fs = compile(gl.FRAGMENT_SHADER, frag);
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'a_pos');
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error('link: ' + log);
      }
      if (program) gl.deleteProgram(program);
      program = p;
      activeType = type;
      u = {};
      for (var i = 0; i < UNI.length; i++) u[UNI[i]] = gl.getUniformLocation(p, UNI[i]);
      return true;
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(rect.width * dpr));
      var h = Math.max(1, Math.round(rect.height * dpr));
      var lo = Math.max(w, h);
      if (lo > MAX_DIM) {
        var s = MAX_DIM / lo;
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    var index = 0;
    var seed = 7;

    function applyPreset(i, publishTint) {
      index = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
      var wp = PRESETS[index];
      seed = 7 + index * 13;
      if (wp.type === 'emoji') {
        buildEmoji(wp);
        current = wp;
      } else {
        try {
          if (wp.type !== activeType) buildProgram(wp.type);
        } catch (e) {
          return;
        }
        var list = [wp.base].concat(wp.colors);
        var last = list[list.length - 1];
        for (var k = 0; k < 8; k++) {
          var c = hexRgb(list[k] || last);
          colorBuf[k * 3] = c[0];
          colorBuf[k * 3 + 1] = c[1];
          colorBuf[k * 3 + 2] = c[2];
        }
        current = wp;
        current._count = list.length;
      }
      if (publishTint !== false) {
        var root = document.documentElement;
        root.style.setProperty('--tint-r', wp.tint[0]);
        root.style.setProperty('--tint-g', wp.tint[1]);
        root.style.setProperty('--tint-b', wp.tint[2]);
        var label = document.querySelector('[data-shot-label]');
        if (label) label.textContent = wp.name;
      }
    }

    var current = null;

    function render(timeSec) {
      if (!current || current.type === 'emoji') return; // emoji = DOM layer, not GL
      if (!program) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(u.u_time, timeSec);
      gl.uniform3fv(u.u_colors, colorBuf);
      gl.uniform1i(u.u_colorCount, current._count);
      gl.uniform1f(u.u_seed, seed);
      gl.uniform1f(u.u_size, current.size || 80);
      gl.uniform1f(u.u_p1, current.p[0]);
      gl.uniform1f(u.u_p2, current.p[1]);
      gl.uniform1f(u.u_p3, current.p[2]);
      var ts = matrixSlots(current.type === 'matrix' ? current.text : '');
      gl.uniform4f(u.u_t0, ts[0], ts[1], ts[2], ts[3]);
      gl.uniform4f(u.u_t1, ts[4], ts[5], ts[6], ts[7]);
      gl.uniform4f(u.u_t2, ts[8], ts[9], ts[10], ts[11]);
      gl.uniform4f(u.u_t3, ts[12], ts[13], ts[14], ts[15]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var startMs = -1;
    var lastMs = -1;
    var raf = 0;
    function frame(now) {
      if (startMs < 0) startMs = now;
      if (lastMs < 0 || now - lastMs >= MIN_FRAME_MS) {
        lastMs = now;
        render((now - startMs) / 1000);
      }
      raf = requestAnimationFrame(frame);
    }

    // Crossfade by briefly dropping the canvas opacity through the swap.
    var fadeTimer = 0;
    function go(i) {
      canvas.style.opacity = '0';
      emojiLayer.style.opacity = '0';
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () {
        applyPreset(i, true);
        if (current && current.type === 'emoji') {
          emojiLayer.style.opacity = '1';
        } else {
          render(lastMs > 0 ? (lastMs - startMs) / 1000 : 0);
          canvas.style.opacity = '1';
        }
      }, 420);
    }

    // Autoplay + manual controls share one timer.
    var auto = 0;
    function schedule() {
      clearInterval(auto);
      if (reduce) return;
      auto = setInterval(function () { go(index + 1); }, 13000);
    }

    var prev = document.querySelector('.demo-prev');
    var next = document.querySelector('.demo-next');
    if (prev) prev.addEventListener('click', function () { go(index - 1); schedule(); });
    if (next) next.addEventListener('click', function () { go(index + 1); schedule(); });
    var scroller = document.querySelector('.demo-scroller');
    if (scroller) {
      scroller.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { go(index - 1); schedule(); }
        else if (e.key === 'ArrowRight') { go(index + 1); schedule(); }
      });
    }

    // Pause the RAF loop when the tab is hidden (battery + GPU).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      } else if (!reduce && !raf) {
        lastMs = -1;
        raf = requestAnimationFrame(frame);
      }
    });

    applyPreset(0, true);
    if (reduce) {
      render(0); // one frozen frame
    } else {
      raf = requestAnimationFrame(frame);
      schedule();
    }
    return true;
  }

  function boot() {
    try {
      start();
    } catch (e) {
      // Any failure → the static CSS backdrop remains. Never blank.
      window.__AMBIENT_LIVE__ = false;
      if (window.console) console.warn('[live-shader] disabled:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
