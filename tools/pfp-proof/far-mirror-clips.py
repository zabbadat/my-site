# SIMULATED test clips for the far-distance / mirror PFP proof. Source: a real person (stock push-up clip,
# /tmp/pfp-startup-measure/person-visible-640x480.y4m), scaled so the ear-to-ear width matches a given distance
# (estimate: 0.15 m face, 70 deg horizontal FOV), moved across the frame. Ground-truth face boxes come from MoveNet
# on the full-size source frames (gt.json). Frame index stamped in the bottom-left 8 px band.
import json, math, sys, numpy as np
from PIL import Image
GT=json.load(open('/tmp/pfp-far/gt.json')); NSRC=len(GT)
SRC=[np.asarray(Image.open(f'/tmp/pfp-far/src/{i:04d}.png'))[40:440] for i in range(NSRC)]  # drop letterbox
WMED=sorted(g['w'] for g in GT)[NSRC//2]
def px_at(ft, W, fov=70): return 0.15*W/(2*ft*0.3048*math.tan(math.radians(fov/2)))
def to_y4m_frame(rgb):
  r,g,b=[rgb[...,i].astype(float) for i in range(3)]
  Y=0.299*r+0.587*g+0.114*b; U=-0.1687*r-0.3313*g+0.5*b+128; V=0.5*r-0.4187*g-0.0813*b+128
  sub=lambda a: a.reshape(a.shape[0]//2,2,a.shape[1]//2,2).mean((1,3))
  return b'FRAME\n'+Y.clip(0,255).astype(np.uint8).tobytes()+sub(U).clip(0,255).astype(np.uint8).tobytes()+sub(V).clip(0,255).astype(np.uint8).tobytes()
def paste(canvas, patch, x0, y0, ymax):
  H,W=canvas.shape[:2]; ph,pw=patch.shape[:2]
  xa,ya=max(0,x0),max(0,y0); xb,yb=min(W,x0+pw),min(ymax,y0+ph)
  if xb>xa and yb>ya: canvas[ya:yb,xa:xb]=patch[ya-y0:yb-y0, xa-x0:xb-x0]
def make(name, W, H, N, ftfn, backlit=False, mirror=False):
  out=open(f'/tmp/pfp-far/clips/{name}.y4m','wb'); out.write(f'YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420jpeg\n'.encode()); gts=[]
  yy,xx=np.mgrid[0:H,0:W]
  for f in range(N):
    t=f/30; si=f%NSRC; g=GT[si]; src=SRC[si]
    if backlit: bg=(235+((xx*7+yy*13+f*5)%17)).clip(0,255)
    else: bg=90+((xx*7+yy*13+f*5)%23)
    fr=np.repeat(bg[...,None],3,2).astype(np.uint8).copy()
    ft=ftfn(t); s=px_at(ft,W)/WMED
    patch=np.asarray(Image.fromarray(src).resize((max(2,round(640*s)),max(2,round(400*s))),Image.LANCZOS)).astype(float)
    if backlit: patch=patch*0.45+25  # backlit subject: darker, lower contrast
    patch=patch.clip(0,255).astype(np.uint8)
    fx=W*(0.5+0.44*math.sin(2*math.pi*t/8)); fy=H*(0.42+0.12*math.sin(2*math.pi*t/3))  # walks edge to edge
    if mirror: fx=W*(0.30+0.24*math.sin(2*math.pi*t/8))
    x0=round(fx-g['cx']*s); y0=round(fy-(g['cy']-40)*s); paste(fr,patch,x0,y0,H-10)
    faces=[{'cx':x0+g['cx']*s,'cy':y0+(g['cy']-40)*s,'w':g['w']*s,'who':'direct'}]
    if mirror:  # reflection: flipped, 0.8x (longer light path), framed in a mirror rect at upper right
      k=0.8; rp=np.asarray(Image.fromarray(patch).resize((max(2,round(patch.shape[1]*k)),max(2,round(patch.shape[0]*k))),Image.LANCZOS))[:, ::-1]
      rcx=(640-g['cx'])*s*k; rcy=(g['cy']-40)*s*k; w=g['w']*s*k
      mx,my=W*0.80,H*0.30; mrx0,mry0,mrx1,mry1=round(mx-3*w),round(my-2.5*w),round(mx+3*w),round(my+4*w)
      tmp=fr.copy(); paste(tmp,rp,round(mx-rcx),round(my-rcy),H-10)
      fr[max(0,mry0):mry1,max(0,mrx0):mrx1]=tmp[max(0,mry0):mry1,max(0,mrx0):mrx1]
      fr[max(0,mry0-2):mry0, max(0,mrx0-2):mrx1+2]=40; fr[mry1:mry1+2, max(0,mrx0-2):mrx1+2]=40
      fr[max(0,mry0):mry1, max(0,mrx0-2):mrx0]=40; fr[max(0,mry0):mry1, mrx1:mrx1+2]=40
      faces.append({'cx':mx,'cy':my,'w':w,'who':'reflection'})
    fr[H-8:H,0:132]=16
    for b in range(16): fr[H-8:H,b*8:b*8+8]=235 if (f>>b)&1 else 16
    out.write(to_y4m_frame(fr)); gts.append({'ft':round(ft,2),'faces':faces})
  json.dump(gts,open(f'/tmp/pfp-far/clips/{name}.json','w')); print(name, 'face px at start', round(gts[0]['faces'][0]['w'],1))
N=240
for W,H in ((640,480),(1280,720)):
  for ft in (20,25,30): make(f'd{ft}-{W}x{H}',W,H,N,lambda t,ft=ft: ft)
  make(f'walkin-{W}x{H}',W,H,N,lambda t: 35-20*t/(N/30))
  make(f'mirror25-{W}x{H}',W,H,N,lambda t: 25,backlit=True,mirror=True)
