/** Controlled SC-HC-01 reproduction. Canonical discovery/extraction/geometry only; no models. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { confirmStaticDiscoveryTarget, prepareStaticTargetEvidence } from "../src/main/source-mask-static-target.js";
import { extractStaticConservativeMask } from "../src/main/source-mask-static-extraction.js";
import { verifyStaticTargetGeometry, readOwnedStaticGeometry } from "../src/main/source-mask-static-geometry.js";

const [directory, ffmpegPath, ffprobePath, pythonPath, amplitudeText = "10"] = process.argv.slice(2);
if (!directory || !ffmpegPath || !ffprobePath || !pythonPath) throw Error("Expected NEW-private-directory ffmpeg ffprobe python [component-amplitude]");
const root = resolve(directory), amplitude = Number(amplitudeText);
if (!Number.isInteger(amplitude) || amplitude < 9 || amplitude > 20) throw Error("bounded amplitude required");
await mkdir(root, { mode: 0o700 });
const run = (binary: string, args: string[]) => {
  const output = spawnSync(binary, args, { timeout: 300000, maxBuffer: 8 * 1024 ** 2, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", OPENBLAS_NUM_THREADS: "1" } });
  if (output.error || output.status !== 0) throw output.error ?? Error(output.stderr.toString());
  return output.stdout;
};
const generation = String.raw`
import numpy as np, cv2, json, sys
from pathlib import Path
root=Path(sys.argv[1]); amplitude=int(sys.argv[2])
w,h,gw,gh=720,1280,202,360
gx,gy,cw,ch=80,140,12,8
def mapped(padding):
 x=(gx-padding)*w//gw; y=(gy-padding)*h//gh
 r=int(np.ceil((gx+cw+padding)*w/gw)); b=int(np.ceil((gy+ch+padding)*h/gh))
 return [x,y,r-x,b-y]
unpadded=mapped(0); padded=mapped(2)
support=np.zeros((gh,gw),np.uint8); support[gy:gy+ch,gx:gx+cw]=1
source_support=np.zeros((h,w),np.uint8)
for yy,xx in zip(*np.where(support)):
 source_support[yy*h//gh:(yy+1)*h//gh,xx*w//gw:(xx+1)*w//gw]=1
x,y,bw,bh=unpadded; px,py,pw,ph=padded
rng=np.random.default_rng(945217)
target=np.full((h,w),128,np.uint8)
# Persistent low-amplitude one-pixel grid-origin spikes establish M1 edge support.
for yy in range(gy,gy+ch):
 for xx in range(gx,gx+cw): target[yy*h//gh,xx*w//gw]=128+(amplitude if (xx+yy)%2 else -amplitude)
padding=np.zeros((h,w),np.uint8); padding[py:py+ph,px:px+pw]=1
# Dynamic sampling-origin moat disconnects M1 membership; all static background is outside target support.
padding[source_support!=0]=0
for yy in range(gy-1,gy+ch+1):
 for xx in range(gx-1,gx+cw+1):
  if not (gx<=xx<gx+cw and gy<=yy<gy+ch): padding[yy*h//gh,xx*w//gw]=0
ring=rng.integers(0,256,(h,w),dtype=np.uint8)
cases={}; backgrounds={}
for name in ['move','disappear','price']:
 texture=ring.copy()
 if name=='price':
  cv2.putText(texture,'PRICE', (px,py+8),cv2.FONT_HERSHEY_PLAIN,0.55,255,1,cv2.LINE_8)
  cv2.putText(texture,'SALE', (px,py+ph-1),cv2.FONT_HERSHEY_PLAIN,0.55,0,1,cv2.LINE_8)
 frames=[]
 with (root/(name+'.rgba')).open('wb') as stream:
  for ordinal in range(30):
   image=np.full((h,w),20 if ordinal%2 else 230,np.uint8)
   image[padding!=0]=texture[padding!=0]
   image[source_support!=0]=126  # underlying local background when opaque target contribution vanishes
   if ordinal!=15: image[source_support!=0]=target[source_support!=0]
   elif name!='disappear':
    mask=np.roll(source_support,1,axis=1); shifted=np.roll(target,1,axis=1)
    image[mask!=0]=shifted[mask!=0]
   rgba=np.empty((h,w,4),np.uint8);rgba[:,:,:3]=image[:,:,None];rgba[:,:,3]=255
   stream.write(rgba.tobytes())
   if ordinal in [0,15,29]: frames.append(rgba.copy())
 cases[name]=np.stack(frames); backgrounds[name]=texture
np.savez_compressed(root/'construction.npz', support_grid=support, support_source=source_support,padding_source=padding,
 grid_box=np.array([gx,gy,cw,ch]),source_box=np.array(padded),unpadded_box=np.array(unpadded),
 frame_ordinals=np.array([0,15,29]),**cases)
(root/'construction.json').write_text(json.dumps({'width':w,'height':h,'gridWidth':gw,'gridHeight':gh,
 'gridBox':{'x':gx,'y':gy,'width':cw,'height':ch},'sourceBox':dict(zip(['x','y','width','height'],padded)),
 'supportGridMarked':int(support.sum()),'supportSourceMarked':int(source_support.sum()),'paddingMarked':int(padding.sum()),
 'changedOrdinal':15,'amplitude':amplitude,'seed':945217,'moatCells':1,'cases':['move','disappear','price']}))
`;
run(pythonPath, ["-B", "-c", generation, root, String(amplitude)]);
const construction = JSON.parse(await readFile(join(root, "construction.json"), "utf8"));
const save = (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
await save("generation-freeze.json", { generationSha256: discoveryHash(generation), construction, modelRequests: 0 });
const sources = ["src/main/shape-cover-stationary-discovery.ts", "src/main/source-mask-static-target.ts", "src/main/source-mask-static-geometry.ts", "scripts/shape-cover-static-geometry.py", "scripts/shape-cover-static-geometry-components.py", "scripts/shape-cover-static-geometry-worker.py"];
await save("method-source-freeze.json", Object.fromEntries(await Promise.all(sources.map(async p => [p, discoveryHash(await readFile(p))]))));
const results = [];
for (const name of construction.cases as string[]) {
  const sourcePath = join(root, `${name}.mp4`);
  run(ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "720x1280", "-r", "10", "-i", join(root, `${name}.rgba`),
    "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "10000", "-n", sourcePath]);
  const source = await identifySource(sourcePath, { width: 720, height: 1280, rotation: 0, durationMs: 3000, timeBase: "1/10000", timeOriginPts: 0, interpretationVersion: 1 });
  const input = { sourcePath, source, ffmpeg: { ffmpegPath, ffprobePath }, signal: new AbortController().signal };
  const discovery = await prepareDiscoveryEvidence(input, { frames: 4 });
  try {
    const result = await discoverStationaryTargets(discovery, input.signal);
    await save(`${name}-discovery.json`, result);
    const component = result.components.find(c => JSON.stringify(c.gridBox) === JSON.stringify(construction.gridBox) && c.state === "CANDIDATE");
    if (!component || component.signals.stablePixels !== construction.supportGridMarked || JSON.stringify(component.sourceBox) !== JSON.stringify(construction.sourceBox)) throw Error(`actual M1 component mismatch for ${name}`);
    const target = await confirmStaticDiscoveryTarget(discovery, { candidateId: component.id, targetId: "09cc9270-1c57-43c5-a384-4bf08f339fd4", confirmedBy: "controlled-constructor",
      description: "low-gradient connected component with disconnected static padding", decision: "CONFIRM_STATIC_TARGET_IDENTITY_AND_RANGE_ONLY", range: { startFrame: 0, endFrame: 30 } }, input.signal);
    const evidence = await prepareStaticTargetEvidence(input, target);
    try {
      const candidate = await extractStaticConservativeMask(evidence, input.signal);
      const geometry = await verifyStaticTargetGeometry(input, evidence, candidate), owned = readOwnedStaticGeometry(geometry);
      await save(`${name}-confirmation.json`, target.receipt); await save(`${name}-candidate.json`, candidate.receipt);
      await save(`${name}-geometry.json`, geometry.receipt); await save(`${name}-geometry-data.json`, owned.data);
      const landmarks = owned.data.reference?.landmarks ?? [];
      const [x, y, width, height] = JSON.parse(run(pythonPath, ["-B", "-c", "import numpy as np,sys,json;print(json.dumps(np.load(sys.argv[1])['unpadded_box'].tolist()))", join(root, "construction.npz")]).toString()) as number[];
      const row = { name, source, candidateId: component.id, gridBox: component.gridBox, sourceBox: component.sourceBox,
        supportGridMarked: component.signals.stablePixels, landmarks: landmarks.length,
        landmarksOutsideUnpadded: landmarks.filter(l => l.sourceX < x || l.sourceX >= x + width || l.sourceY < y || l.sourceY >= y + height).length,
        status: geometry.receipt.status, componentStatus: geometry.receipt.components[0].status, issueFrames: geometry.receipt.issueFrames,
        changedFrame: owned.data.frames.find(f => f.index === 15) };
      results.push(row); console.log(JSON.stringify(row));
    } finally { await evidence.close(); }
  } finally { await discovery.close(); }
}
await save("pre-fix-results.json", { construction, results, fixtureSha256: discoveryHash(await readFile(join(root, "construction.npz"))), modelRequests: 0 });
// Freeze actual canonical decoded pixels rather than pre-encode construction pixels.
run(pythonPath, ["-B", "-c", String.raw`
import hashlib,json,subprocess,sys,numpy as np
from pathlib import Path
root=Path(sys.argv[1]);ffmpeg=sys.argv[2]
with np.load(root/'construction.npz') as construction:
 arrays={k:construction[k] for k in construction.files}
frame_hashes={}
for name in ['move','disappear','price']:
 output=subprocess.run([ffmpeg,'-v','error','-i',str(root/(name+'.mp4')),
  '-vf',r'select=eq(n\,0)+eq(n\,15)+eq(n\,29)','-vsync','0','-pix_fmt','rgba','-f','rawvideo','pipe:1'],
  capture_output=True,check=True,timeout=30).stdout
 assert len(output)==3*720*1280*4
 frames=np.frombuffer(output,np.uint8).reshape(3,1280,720,4).copy()
 arrays[name]=frames;frame_hashes[name]=[hashlib.sha256(f.tobytes()).hexdigest() for f in frames]
results=json.loads((root/'pre-fix-results.json').read_text())
metadata={'construction':results['construction'],'preFix':results['results'],'framePixelSha256':frame_hashes,
 'supportMapping':'detector-origin-floor-to-floor-partition/v1','baselineCommit':'545a4259a204993f65657813e3589a234d1a9e73'}
arrays['metadata_json_utf8']=np.frombuffer(json.dumps(metadata,separators=(',',':')).encode(),np.uint8)
np.savez_compressed(root/'frozen-counterexamples.npz',**arrays)
`, root, ffmpegPath]);
