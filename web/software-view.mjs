// A small, honest Canvas 2D raster fallback for environments without a graphics adapter.
// It projects the actual mesh. It is not WebGPU, and is not used for mechanics.
export class SoftwareView {
  constructor(canvas,container){
    this.canvas=canvas;this.container=container;this.context=canvas.getContext('2d');
    if(!this.context)throw Error('Canvas rendering is unavailable.');
    this.yaw=-.6;this.pitch=.4;this.zoom=1;this.pending=false;this.wireframe=false;this.data=null;
    let drag=null;
    canvas.addEventListener('pointerdown',event=>{drag=[event.clientX,event.clientY,this.yaw,this.pitch];canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!drag)return;this.yaw=drag[2]+(event.clientX-drag[0])*.009;this.pitch=Math.max(-1.15,Math.min(1.15,drag[3]+(event.clientY-drag[1])*.007));this.schedule();});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
    canvas.addEventListener('wheel',event=>{event.preventDefault();this.zoom=Math.max(.5,Math.min(2.5,this.zoom*Math.exp(-event.deltaY*.001)));this.schedule();},{passive:false});
    new ResizeObserver(()=>this.schedule()).observe(container);
  }
  setMesh(data){this.data=data;this.reset();}
  reset(){this.yaw=-.6;this.pitch=.4;this.zoom=1;this.schedule();}
  schedule(){if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.render();});}
  render(){
    const {data}=this;if(!data)return;
    const rect=this.container.getBoundingClientRect(),width=Math.max(1,Math.round(Math.min(850,rect.width))),height=Math.max(1,Math.round(rect.height*width/rect.width));
    this.canvas.width=width;this.canvas.height=height;
    const ctx=this.context;ctx.clearRect(0,0,width,height);
    const img=ctx.createImageData(width,height),pixels=img.data,depth=new Float32Array(width*height).fill(-Infinity);
    const {positions:p,indices:ix,spec}=data,N=p.length/3;
    const projected=new Float32Array(N*3),cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
    const scale=Math.min(width/(spec.size_mm*1.55),height/(Math.max(spec.height_mm,spec.size_mm)*1.65))*this.zoom;
    const yCenter=spec.envelope==='curved'?spec.size_mm*.21:0;
    for(let i=0;i<N;i++){
      const x=p[i*3],y=p[i*3+1]-yCenter,z=p[i*3+2];
      const u=cy*x-sy*y,v=sy*x+cy*y;
      projected[i*3]=width*.5+u*scale;projected[i*3+1]=height*.5-(cp*z-sp*v)*scale;projected[i*3+2]=cp*v+sp*z;
    }
    const lines=[];
    for(let i=0;i<ix.length;i+=3){
      const a=3*ix[i],b=3*ix[i+1],c=3*ix[i+2];
      const x0=projected[a],y0=projected[a+1],z0=projected[a+2],x1=projected[b],y1=projected[b+1],z1=projected[b+2],x2=projected[c],y2=projected[c+1],z2=projected[c+2];
      const denom=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2);if(Math.abs(denom)<.004)continue;
      const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2))),maxX=Math.min(width-1,Math.ceil(Math.max(x0,x1,x2)));
      const minY=Math.max(0,Math.floor(Math.min(y0,y1,y2))),maxY=Math.min(height-1,Math.ceil(Math.max(y0,y1,y2)));
      const ux=x1-x0,uy=y1-y0,uz=(z1-z0)*scale,vx=x2-x0,vy=y2-y0,vz=(z2-z0)*scale;
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const norm=Math.hypot(nx,ny,nz)||1;
      nx/=norm;ny/=norm;nz/=norm;if(nz<0){nx=-nx;ny=-ny;nz=-nz;}
      const light=Math.max(.22,.36+.62*Math.max(0,-.4*nx-.55*ny+.72*nz));
      const top=Math.max(0,Math.min(1,(p[a+2]+p[b+2]+p[c+2])/(3*spec.height_mm)+.5));
      const rr=(134+70*top)*light,gg=(164+57*top)*light,bb=(223+30*top)*light;
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const xx=x+.5,yy=y+.5,w0=((y1-y2)*(xx-x2)+(x2-x1)*(yy-y2))/denom,w1=((y2-y0)*(xx-x2)+(x0-x2)*(yy-y2))/denom,w2=1-w0-w1;
        if(w0<-.0001||w1<-.0001||w2<-.0001)continue;
        const z=w0*z0+w1*z1+w2*z2,j=y*width+x;
        if(z>depth[j]){depth[j]=z;const k=j*4;pixels[k]=rr;pixels[k+1]=gg;pixels[k+2]=bb;pixels[k+3]=255;}
      }
      if(this.wireframe&&i%9===0)lines.push([x0,y0,x1,y1,x2,y2]);
    }
    ctx.putImageData(img,0,0);
    if(this.wireframe){ctx.strokeStyle='#e1ebff38';ctx.lineWidth=.35;ctx.beginPath();for(const a of lines){ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.lineTo(a[4],a[5]);ctx.closePath();}ctx.stroke();}
  }
}
