"""Offline, candidate-blind original ROI truth authoring. No automated truth.

prepare input.json NEW-directory application-ffmpeg
Input: record/method/context/bindings/geometryFrames/development. No candidate.
Generated human labels are drafts; QA attestations and truth freeze are separate.
"""
import base64
import importlib.util
import json
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

import numpy as np
from PIL import Image


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


h = load_module("holdout", "shape-cover-static-holdout.py")
decoder = load_module("m2b_stream", "shape-cover-static-anomalies.py")


def roi_risk(frame, previous, target_box):
    """Original-pixel scalar observations, independent of extractor support/mask."""
    rgb = frame[..., :3].astype(np.float64)
    gray = rgb.mean(axis=2)
    edge = np.zeros_like(gray)
    edge[:, 1:] += np.abs(np.diff(gray, axis=1))
    edge[1:, :] += np.abs(np.diff(gray, axis=0))
    x, y, w, height = (target_box[k] for k in ("x", "y", "width", "height"))
    h.require(w > 0 and height > 0 and x >= 0 and y >= 0 and x + w <= gray.shape[1] and y + height <= gray.shape[0], "confirmed target ROI extent")
    outside = np.ones_like(gray, dtype=bool); outside[y:y + height, x:x + w] = False
    h.require(outside.any(), "background risk context missing")
    patch = rgb[y:y + height, x:x + w]
    edges = edge[y:y + height, x:x + w]
    chroma = patch.max(axis=2) - patch.min(axis=2)
    delta = np.abs(rgb - previous).mean() if previous is not None else 0
    return {"edgeEnergy": float(edges.mean()), "edgeChroma": float((chroma * edges).mean()),
            "rgbR": float(patch[..., 0].mean()), "rgbG": float(patch[..., 1].mean()), "rgbB": float(patch[..., 2].mean()),
            "rgbDelta": float(delta), "backgroundLuma": float(gray[outside].mean())}, rgb


def blind_manifest(plan):
    data = plan.data
    h.exact(data["context"], ("source", "sourceKey", "targetId", "confirmationDigest", "roi", "range"), "context")
    h.source_schema(data["context"]["source"])
    h.exact(data["context"]["roi"], ("x", "y", "width", "height"), "ROI")
    h.exact(data["context"]["range"], ("startFrame", "endFrame"), "range")
    for binding in data["bindings"]:
        h.exact(binding, ("index", "pts", "endPts", "byteLength", "pixelSha256"), "frame binding")
    # Explicit allowlist; no method freeze, selection reasons or geometry metrics reach humans.
    return {"schema": "static-roi-human-review-package/v1", "authority": "none", "eligible": False,
            "planDigest": plan.digest, "context": data["context"], "bindings": data["bindings"],
            "rules": "Required: visible fill, outline, AA, thin tips, text and discernible low-alpha contribution. Unclear => UNKNOWN. No candidate verdict."}


EDITOR = r'''<!doctype html><html lang="zh"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>ROI Required-Pixel Truth</title><style>
body{font:16px sans-serif;margin:24px;background:#eee;color:#111}canvas{image-rendering:pixelated;background:white;border:1px solid #222;touch-action:none}
button,select,input{margin:4px;padding:7px}#original{display:block}#position{white-space:pre-wrap}label{display:block}
</style><h1>ROI Required-Pixel Truth</h1><p id="rules"></p><p>原图保持1:1原像素；zoom只作整数倍显示。未标像素为UNKNOWN。此工具不判断candidate。</p>
<button id="prev">上一帧</button><button id="next">下一帧</button><span id="position"></span><br>
<select id="zoom"><option>1</option><option selected>4</option><option>8</option></select>
<select id="label"><option value="1">Required</option><option value="0">Known background</option><option value="2">UNKNOWN</option></select>
<button id="background">明确整ROI为background</button><button id="unknown">整ROI设UNKNOWN</button>
<p>Original ROI</p><canvas id="original"></canvas><p>Original + human truth overlay</p><canvas id="overlay"></canvas>
<label>导入自己的truth草稿 / Pass B作者truth：<input id="import" type="file" accept="application/json"></label>
<select id="mode"><option value="AUTHOR">Pass A author</option><option value="QA">Pass B independent QA (只读)</option></select>
<select id="boundary"><option value="UNKNOWN">目标边界UNKNOWN</option><option value="BOUNDED">已独立界定完整边界</option></select>
<button id="download">保存truth草稿</button><p id="status"></p>
<label>真实reviewerId：<input id="reviewer" maxlength="160"></label>
<label><input id="decl-algorithm" type="checkbox">我未开发mask算法</label>
<label><input id="decl-mask" type="checkbox">我未查看candidate mask</label>
<label><input id="decl-outcome" type="checkbox">truth freeze前我未查看comparator outcome</label>
<label><input id="decl-hints" type="checkbox">我未收到expected pixel hints</label>
<select id="decision"><option value="UNKNOWN">UNKNOWN</option><option value="APPROVE">Approve truth</option><option value="REQUEST_CORRECTION">Request correction</option></select>
<button id="declaration">保存本人truth声明 / QA决定</button><p>声明不是身份认证；研发负责人仍需核实来源和两位独立真人。</p>
<script>
const packageData=__PACKAGE__;
const w=packageData.context.roi.width,h=packageData.context.roi.height;
const labels=packageData.bindings.map(()=>new Uint8Array(w*h).fill(2));
let index=0,painting=false,ready=false,generation=0;const original=document.querySelector('#original'),overlay=document.querySelector('#overlay');
for(const canvas of [original,overlay]){canvas.width=w;canvas.height=h;}
document.querySelector('#rules').textContent=packageData.rules;
function redraw(){
 const renderGeneration=++generation;painting=false;
 const z=Number(document.querySelector('#zoom').value);
 for(const canvas of [original,overlay]){canvas.style.width=(w*z)+'px';canvas.style.height=(h*z)+'px';}
 const b=packageData.bindings[index];
 document.querySelector('#position').textContent=`${index+1}/${labels.length} | ordinal ${b.index} | PTS ${b.pts} | time ${b.pts * Number(packageData.context.source.timeBase.split('/')[0]) / Number(packageData.context.source.timeBase.split('/')[1])}s`;
 const image=new Image();ready=false;
 image.onload=()=>{if(renderGeneration!==generation)return;original.getContext('2d').drawImage(image,0,0);ready=true;drawOverlay();};image.src=packageData.images[index];
}
function drawOverlay(){
 const ctx=overlay.getContext('2d');ctx.drawImage(original,0,0);const pixels=ctx.getImageData(0,0,w,h);
 for(let i=0;i<labels[index].length;i++){
  const color=labels[index][i]===1?[255,50,50]:labels[index][i]===2?[255,200,0]:null;
  if(color)for(let c=0;c<3;c++)pixels.data[i*4+c]=Math.round(pixels.data[i*4+c]*.6+color[c]*.4);
 }ctx.putImageData(pixels,0,0);
 document.querySelector('#status').textContent=`UNKNOWN pixels: ${Array.from(labels[index]).filter(v=>v===2).length}. 保存仍只是draft；需要独立QA和freeze。`;
}
function paint(event){
 if(!painting||!ready||document.querySelector('#mode').value!=='AUTHOR')return;
 const box=overlay.getBoundingClientRect();
 const x=Math.floor((event.clientX-box.left-overlay.clientLeft)*w/overlay.clientWidth),y=Math.floor((event.clientY-box.top-overlay.clientTop)*h/overlay.clientHeight);
 if(x>=0&&x<w&&y>=0&&y<h){labels[index][y*w+x]=Number(document.querySelector('#label').value);drawOverlay();}
}
overlay.onpointerdown=e=>{painting=true;overlay.setPointerCapture(e.pointerId);paint(e);};overlay.onpointermove=paint;overlay.onpointerup=()=>painting=false;
document.querySelector('#prev').onclick=()=>{index=Math.max(0,index-1);redraw();};document.querySelector('#next').onclick=()=>{index=Math.min(labels.length-1,index+1);redraw();};
document.querySelector('#zoom').onchange=redraw;
for(const [id,value]of [['background',0],['unknown',2]])document.querySelector('#'+id).onclick=()=>{if(document.querySelector('#mode').value==='AUTHOR'){labels[index].fill(value);drawOverlay();}};
document.querySelector('#import').onchange=async event=>{
 try{const truth=JSON.parse(await event.target.files[0].text());
  if(truth.planDigest!==packageData.planDigest||JSON.stringify(truth.context)!==JSON.stringify(packageData.context)||truth.frames.length!==labels.length)throw Error('wrong plan/context');
  const temporary=truth.frames.map((frame,i)=>{
   if(JSON.stringify(frame.binding)!==JSON.stringify(packageData.bindings[i]))throw Error('wrong frame binding');
   const raw=Uint8Array.from(atob(frame.labelsBase64),c=>c.charCodeAt(0));if(raw.length!==w*h||raw.some(v=>v>2))throw Error('bad raster');return raw;
  });temporary.forEach((v,i)=>labels[i].set(v));document.querySelector('#boundary').value=truth.boundaryReview;redraw();
 }catch(error){document.querySelector('#status').textContent=String(error);}
};
async function sha(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}
async function buildTruth(){
 const truth={schema:'static-roi-human-truth/v1',authority:'none',eligible:false,planDigest:packageData.planDigest,context:packageData.context,boundaryReview:document.querySelector('#boundary').value,frames:[]};
 for(let i=0;i<labels.length;i++){let text='';for(const v of labels[i])text+=String.fromCharCode(v);truth.frames.push({binding:packageData.bindings[i],labelsBase64:btoa(text),truthSha256:await sha(labels[i])});}
 return truth;
}
function download(data,name){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.download=name;link.click();URL.revokeObjectURL(link.href);}
function canonical(value){return Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);}
document.querySelector('#download').onclick=async()=>download(await buildTruth(),'human-truth-draft.json');
document.querySelector('#declaration').onclick=async()=>{
 const reviewerId=document.querySelector('#reviewer').value.trim();
 if(!reviewerId||['algorithm','mask','outcome','hints'].some(id=>!document.querySelector('#decl-'+id).checked)){document.querySelector('#status').textContent='缺少真实身份或independence声明；不能代填。';return;}
 const truth=await buildTruth();
 download({reviewerId,role:document.querySelector('#mode').value,decision:document.querySelector('#decision').value,
  didNotAuthorMaskAlgorithm:true,didNotInspectCandidateMask:true,didNotInspectComparatorOutcomeBeforeTruthFreeze:true,didNotReceiveExpectedPixelHints:true,
  truthContentDigest:await sha(new TextEncoder().encode(canonical(truth))),planDigest:packageData.planDigest,evidenceClass:'ACTUAL_HUMAN_ATTESTATION'},'human-declaration.json');
};redraw();
</script></html>'''


def package(plan, rgba_frames, output, cancel=lambda: False):
    started = time.monotonic()
    target = Path(output); target.mkdir(mode=0o700, exist_ok=False)
    manifest = blind_manifest(plan); images = []
    for binding in manifest["bindings"]:
        if cancel(): raise InterruptedError("cancelled")
        frame = rgba_frames[binding["index"]]
        h.require(frame.dtype == np.uint8 and frame.shape == (manifest["context"]["roi"]["height"], manifest["context"]["roi"]["width"], 4)
                  and h.sha(frame.tobytes()) == binding["pixelSha256"], "reviewer original ROI hash/extent")
        name = "frame-" + str(binding["index"]) + ".png"
        Image.fromarray(frame).save(target / name)
        images.append("data:image/png;base64," + base64.b64encode((target / name).read_bytes()).decode())
    manifest["images"] = images
    payload = h.encode(manifest).replace("<", "\\u003c").replace("&", "\\u0026")
    html = EDITOR.replace("__PACKAGE__", payload).encode()
    h.require(len(html) + sum(p.stat().st_size for p in target.iterdir()) <= h.MAX_BYTES, "reviewer package byte budget")
    (target / "review.html").write_bytes(html)
    # Signed QA declarations are never generated by the authoring tool.
    (target / "manifest.json").write_text(h.encode({k: v for k, v in manifest.items() if k != "images"}))
    return {"authority": "none", "eligible": False, "frames": len(images), "packageSeconds": time.monotonic() - started,
            "artifactBytes": sum(p.stat().st_size for p in target.iterdir()), "modelRequests": 0, "humanTruth": "NOT_AUTHORED"}


def prepare(raw, output, engine):
    h.exact(raw, ("record", "method", "context", "bindings", "geometryFrames", "targetBox", "development"), "prepare input")
    registry = h.Registry(); registry.register(raw["record"])
    source = registry.freeze_source(raw["record"]["sourceId"], raw["method"], development=raw["development"] is True)
    context, bindings = raw["context"], raw["bindings"]
    h.comparator.validate_bindings(context, bindings)
    h.require(len(bindings) == len(raw["geometryFrames"]), "full geometry metrics missing")
    metrics = {key: [] for key in h.RISK_METRICS}; ambiguous=[]; previous=None; started=time.monotonic()
    # FFmpeg's built-in scene score is only a frame-selection observation, never target truth.
    scene_result = subprocess.run([str(engine), "-v", "info", "-nostdin", "-threads", "1", "-i", raw["record"]["sourcePath"],
                                  "-vf", "select=gt(scene\\,0.3),showinfo", "-vsync", "0", "-an", "-sn", "-dn", "-f", "null", "-"],
                                 capture_output=True, timeout=120, check=True)
    h.require(len(scene_result.stderr) <= h.MAX_BYTES, "scene observation byte budget")
    by_pts = {b["pts"]: b["index"] for b in bindings}
    cuts = []
    for line in scene_result.stderr.decode(errors="replace").splitlines():
        if "showinfo" not in line or "pts_time:" not in line: continue
        match = re.search(r"\bpts:\s*(-?\d+)", line)
        h.require(match is not None, "scene clock missing")
        pts = int(match.group(1))
        if pts in by_pts: cuts.append(by_pts[pts])
        else:
            h.require(pts < bindings[0]["pts"] or pts >= bindings[-1]["endPts"], "scene original PTS mismatch")

    def observe(frame, binding):
        nonlocal previous
        index = binding["index"] - context["range"]["startFrame"]
        g = raw["geometryFrames"][index]
        h.require(all(g[k] == binding[k] for k in binding), "geometry original frame binding")
        values, previous = roi_risk(frame, previous, raw["targetBox"])
        values.update(geometryOffset=max(abs(v) for v in g["globalOffset"] + [n for cell in g["cells"] for n in cell["offset"]]),
                      geometryCorrelation=min([g["globalAlignment"]["correlation"]] + [c["correlation"] for c in g["cells"]]),
                      geometryLost=g["lostLandmarkFraction"])
        for key in metrics: metrics[key].append(values[key])
        if g["state"] != "STATIC_GEOMETRY_OBSERVED" or g["reasons"]: ambiguous.append(binding["index"])

    refs = {**raw["method"]["files"], str(engine): h.file_sha(engine)}
    decoder.decode(Path(raw["record"]["sourcePath"]), Path(engine), context["roi"], bindings, context["source"]["timeBase"], observe, started + 300)
    risk = {"contextDigest": h.digest(context), "bindingsDigest": h.digest(bindings), "complete": True,
            "metrics": metrics, "sceneCuts": cuts, "visibilityAmbiguities": ambiguous}
    plan = registry.freeze_plan(source, context, bindings, risk)
    selected = set(b["index"] for b in plan.data["bindings"]); frames={}

    def collect(frame, binding):
        if binding["index"] in selected: frames[binding["index"]] = frame.copy()

    decoder.decode(Path(raw["record"]["sourcePath"]), Path(engine), context["roi"], bindings, context["source"]["timeBase"], collect, started + 300)
    h.checked_refs(refs); registry._assert(source,"source")
    result = package(plan, frames, output)
    registry._assert(source, "source"); h.checked_refs(refs)
    target = Path(output)
    # Private sidecars are outside the reviewer directory.
    sidecar = target.with_name(target.name + "-private")
    sidecar.mkdir(mode=0o700,exist_ok=False)
    for name, data in (("source-freeze",source.data),("plan",plan.data),("risk",risk),("prepare-input",raw),("registry",registry.records)):
        (sidecar/(name+".json")).write_text(h.encode(data))
    (sidecar/"freeze-digests.json").write_text(h.encode({"sourceDigest":source.digest,"planDigest":plan.digest,"reviewHtmlSha256":h.file_sha(target/"review.html")}))
    result.update(usage=source.data["usage"],planDigest=plan.digest,fullRangeFrames=len(bindings),riskObservationSeconds=time.monotonic()-started)
    (sidecar/"package-result.json").write_text(h.encode(result))
    return result


def compare_frozen(directory, truth_path, author_path, qa_path, candidate_path, output):
    """Read frozen private sidecars; JSON itself conveys no independence/authority.

    The CLI deliberately cannot assert actual human identity. A real zero-miss result
    remains SOURCE_INCOMPLETE until the parent checks actual evidence via Registry API.
    """
    directory = Path(directory)
    raw = h.comparator.read_json(directory / "prepare-input.json")
    risk = h.comparator.read_json(directory / "risk.json")
    frozen = h.comparator.read_json(directory / "freeze-digests.json")
    registry = h.Registry(); registry.register(raw["record"])
    source = registry.freeze_source(raw["record"]["sourceId"], raw["method"], development=raw["development"] is True)
    plan = registry.freeze_plan(source, raw["context"], raw["bindings"], risk)
    h.require(source.digest == frozen["sourceDigest"] and plan.digest == frozen["planDigest"], "persisted source/method/plan freeze changed")
    refs = [{"path": p, "sha256": h.file_sha(p)} for p in (author_path, qa_path)]
    truth = registry.freeze_truth(plan, h.comparator.read_json(truth_path), *refs)
    # Freeze the exact submitted truth bytes as well as the internal immutable snapshot.
    truth_refs = registry._owned[truth][1]
    truth_refs[str(truth_path)] = h.file_sha(truth_path)
    candidate = h.comparator.read_json(candidate_path)
    h.require(candidate["context"] == plan.data["context"] and candidate["bindings"] == raw["bindings"]
              and candidate["methodDigest"] == source.data["methodDigest"], "candidate frozen method/source binding")
    # Preserve the first candidate even across CLI restarts and failed comparisons.
    # This audit pin conveys no authority or human identity acceptance.
    pin = {"sourceDigest": source.digest, "planDigest": plan.digest, "truthDigest": truth.digest,
           "candidateDigest": h.digest(candidate)}
    pin_path = directory / "comparison-candidate-freeze.json"
    try:
        with pin_path.open("x") as stream: stream.write(h.encode(pin))
    except FileExistsError:
        h.require(h.comparator.read_json(pin_path) == pin, "FROZEN_CANDIDATE_OR_TRUTH_CHANGED_NEW_HOLDOUT_REQUIRED")
    result = registry.compare(source, plan, truth, candidate)
    # No overwrite or revision of a failed qualification outcome.
    with Path(output).open("x") as stream: stream.write(h.encode(result))
    return result


if __name__ == "__main__":
    def stop(_number, _frame): raise InterruptedError("cancelled")
    signal.signal(signal.SIGTERM, stop)
    if len(sys.argv) == 5 and sys.argv[1] == "prepare":
        raw=h.comparator.read_json(sys.argv[2])
        result=prepare(raw,sys.argv[3],sys.argv[4])
    elif len(sys.argv) == 8 and sys.argv[1] == "compare":
        result=compare_frozen(*sys.argv[2:])
    else:
        raise ValueError("prepare input.json NEW-directory application-ffmpeg | compare private-directory truth.json author.json qa.json candidate.json NEW-result.json")
    print(json.dumps(result))
