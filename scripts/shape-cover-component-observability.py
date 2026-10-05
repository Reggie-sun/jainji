"""M2-HC3 offline diagnostics. Never imported by production; never issues proof.

Freeze methods + all inputs before either real/frozen suite. Detector footprint
and construction support have separate provenance; final mask is display only.
"""
import argparse
import base64
import importlib.util
import json
from pathlib import Path
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


support_kernel = module("hc3_support", "shape-cover-static-geometry-support.py")
g = support_kernel.kernel
components = module("hc3_v2", "shape-cover-static-geometry-components.py")
METHOD_FILE = Path(__file__).with_name("shape-cover-component-observability-methods.json")


def load(path):
    return json.loads(Path(path).read_text())


def write(root, name, value):
    (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def gray(frame):
    return frame[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])


def occupancy(support, size):
    # Integer counts avoid misclassifying 49/49 as 0.9999999999999999 in reports.
    counts=cv2.boxFilter(support.astype(np.float64), -1, (size, size), normalize=False,
                         borderType=cv2.BORDER_CONSTANT)
    return np.rint(counts)/(size*size)


def morphology(support):
    ys, xs = np.where(support)
    # Boundary pixel has distance zero. DIST_C-1 matches square-stencil erosion.
    padded = np.pad(support.astype(np.uint8), 1)
    chess = cv2.distanceTransform(padded, cv2.DIST_C, 3)[1:-1, 1:-1] - 1
    euclid = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    count, _, stats, _ = cv2.connectedComponentsWithStats(support.astype(np.uint8), 8)
    contours, hierarchy = cv2.findContours(support.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    holes = [] if hierarchy is None else [i for i, h in enumerate(hierarchy[0]) if h[3] >= 0]
    perimeter = int(np.count_nonzero(support & (padded[:-2,1:-1]==0))
                    + np.count_nonzero(support & (padded[2:,1:-1]==0))
                    + np.count_nonzero(support & (padded[1:-1,:-2]==0))
                    + np.count_nonzero(support & (padded[1:-1,2:]==0)))
    return {"pixels": int(support.sum()), "bboxLocal": [int(xs.min()), int(ys.min()), int(np.ptp(xs)+1), int(np.ptp(ys)+1)],
            "connected8": count-1, "componentAreas": stats[1:, cv2.CC_STAT_AREA].tolist(),
            "holeCount": len(holes), "holeContourAreas": [cv2.contourArea(contours[i]) for i in holes],
            "perimeterExposedPixelEdges": perimeter, "boundaryPixels": int((support & (chess == 0)).sum()),
            "distanceDefinition": "Chebyshev distance to owned boundary pixels; boundary=0; outside is -1",
            "distanceAtLeast": {str(k): int((support & (chess >= k)).sum()) for k in range(5)},
            "distanceHistogram": {str(k): int((support & (chess == k)).sum()) for k in range(int(chess.max())+1)},
            "euclideanToNonSupportQuantiles": np.quantile(euclid[support], [0,.25,.5,.75,1]).tolist()}, chess


def without_support(frame, support):
    """An intervention, NOT reconstructed background or alpha truth."""
    value = gray(frame)
    outside = value[~support]
    fallback = float(np.median(outside)) if len(outside) else 0.0
    padded = np.pad(value, 3, mode="reflect")
    owned = np.pad(support, 3, mode="constant", constant_values=True)
    output = value.copy()
    for y, x in np.argwhere(support):
        region = padded[y:y+7, x:x+7][~owned[y:y+7, x:x+7]]
        output[y, x] = np.median(region) if len(region) else fallback
    output = cv2.GaussianBlur(output, (5,5), g.CONFIG["gaussianSigma"], borderType=cv2.BORDER_REFLECT_101)
    return np.stack([cv2.Sobel(output, cv2.CV_64F, 1,0,ksize=3,scale=.125),
                     cv2.Sobel(output, cv2.CV_64F, 0,1,ksize=3,scale=.125)], axis=-1)


def gradient_references(samples, box, support, methods, params):
    common_start=time.perf_counter()
    stack = np.stack([g.gradients(f) for f in samples])
    reference = np.median(stack, axis=0)
    norm = np.linalg.norm(reference, axis=-1)
    observed = np.linalg.norm(stack, axis=-1)
    cosine = (stack*reference).sum(axis=-1)/np.maximum(observed*norm, 1e-12)
    ratio = observed/np.maximum(norm, 1e-12)
    c = g.CONFIG
    persistent = (norm >= c["minimumGradient"]) & (((cosine >= c["sampleDirectionCosine"]) &
        (ratio >= c["sampleStrengthRatio"][0]) & (ratio <= c["sampleStrengthRatio"][1])).mean(axis=0) >= c["sampleConsensus"])
    h,w = support.shape
    yy,xx = np.indices((h,w)); margin = c["searchRadius"]+2
    bounds = (xx >= max(margin,box["x"])) & (xx < min(w-margin,box["x"]+box["width"])) & \
        (yy >= max(margin,box["y"])) & (yy < min(h-margin,box["y"]+box["height"]))
    stride = (xx%2 == 0) & (yy%2 == 0)
    cx = np.clip((xx-box["x"])*3//box["width"],0,2)
    cy = np.clip((yy-box["y"])*3//box["height"],0,2)
    cell_map = cy*3+cx
    coverage = occupancy(support,7)
    common_ms=(time.perf_counter()-common_start)*1000
    attribution_start = time.perf_counter()
    effect = reference-np.median(np.stack([without_support(f,support) for f in samples]),axis=0)
    effect_norm = np.linalg.norm(effect,axis=-1)
    contribution = (effect_norm >= params["attribution"]["minimumContribution"]) & \
        (effect_norm/np.maximum(norm,1e-12) >= params["attribution"]["minimumRelativeContribution"])
    attribution_ms = (time.perf_counter()-attribution_start)*1000
    models, details = {}, {}
    for method in methods:
        if method in ["internal-pairs", "masked-ncc"]:
            continue
        selection_start=time.perf_counter()
        owned = support.copy()
        if method in ["strict7", "occupancy100"]:
            owned &= cv2.erode(support.astype(np.uint8), np.ones((7,7),np.uint8),
                               borderType=cv2.BORDER_CONSTANT,borderValue=0).astype(bool)
        elif method.startswith("occupancy"):
            owned &= coverage >= int(method.removeprefix("occupancy"))/100
        elif method == "attribution":
            owned &= contribution
        eligible = owned & persistent & bounds & stride
        points,cells = [],[]
        counts = []
        for cell in range(9):
            ys,xs = np.where(eligible & (cell_map == cell))
            counts.append(len(xs))
            order = sorted(range(len(xs)),key=lambda i:(-norm[ys[i],xs[i]],int(ys[i]),int(xs[i])))[:c["landmarksPerCell"]]
            if len(order) < c["minimumLandmarksPerCell"]:
                continue
            for i in order:
                points.append([int(xs[i]),int(ys[i])]); cells.append(cell)
        xy = np.array(points,np.int32).reshape(-1,2)
        enough = len(set(cells)) >= c["minimumCells"]
        span = len(xy)>0 and np.ptp(xy[:,0]) >= box["width"]*c["minimumSpatialSpan"] and np.ptp(xy[:,1]) >= box["height"]*c["minimumSpatialSpan"]
        models[method] = {"extent":[w,h],"box":box,"xy":xy,"vectors":reference[xy[:,1],xy[:,0]],
                          "cells":np.array(cells,np.int32),"sampleCount":len(samples)} if enough and span else None
        details[method] = {"rawOwnedAnchors":int(owned.sum()), "ownedPersistent":int((owned & persistent).sum()),
            "eligibleBeforeCells":int(eligible.sum()),"cellCounts":counts,"selectedLandmarks":len(xy),
            "usableCells":len(set(cells)),"spatialSpanPassed":bool(span), "observable":bool(enough and span),
            "eligibleXY":np.stack(np.where(eligible)[::-1],axis=1).tolist(),
            "attributionExtraBuildMs":attribution_ms if method=="attribution" else 0,
            "buildMs":common_ms+(time.perf_counter()-selection_start)*1000+(attribution_ms if method=="attribution" else 0)}
    return models,details


def pair_coordinates(support, distances):
    pairs=[]
    h,w=support.shape
    for d in distances:
        for dx,dy in [(d,0),(0,d)]:
            valid=support.copy()
            for k in range(d+1):
                shifted=np.zeros_like(support)
                sx,sy=k if dx else 0,k if dy else 0
                shifted[:h-sy,:w-sx]=support[sy:,sx:]
                valid &= shifted
            y,x=np.where(valid)
            pairs.extend(zip(x.tolist(),y.tolist(),(x+dx).tolist(),(y+dy).tolist()))
    return np.array(pairs,np.int32).reshape(-1,4)


def independent_reference(samples,support,method,params):
    ys,xs=np.where(support)
    if method=="internal-pairs":
        pairs=pair_coordinates(support,params[method]["distances"])
        patterns=np.stack([gray(f)[pairs[:,1],pairs[:,0]]-gray(f)[pairs[:,3],pairs[:,2]] for f in samples])
        ref=np.median(patterns,axis=0)
        observable=len(pairs)>=params[method]["minimumPairs"] and np.sqrt(np.mean(ref**2))>=params[method]["minimumReferenceRms"]
        return {"method":method,"pairs":pairs,"reference":ref} if observable else None,len(pairs)
    pattern=np.median(np.stack([f[ys,xs,:3].astype(np.float64) for f in samples]),axis=0)
    ref=pattern-pattern.mean(axis=0)
    contrast=float(np.std(pattern @ np.array([.299,.587,.114])))
    observable=len(xs)>=params[method]["minimumPixels"] and contrast>=params[method]["minimumSpatialGrayStd"]
    return {"method":method,"xy":np.stack([xs,ys],axis=1),"reference":ref.ravel()} if observable else None,len(xs)


def independent_measure(frame,model,params):
    radius=params["integerRadius"]
    offsets=[(dx,dy) for dy in range(-radius,radius+1) for dx in range(-radius,radius+1)]
    ref=model["reference"]
    points=model.get("pairs",model.get("xy"))
    xvalues=points[:,[0,2]] if model["method"]=="internal-pairs" else points[:,0]
    yvalues=points[:,[1,3]] if model["method"]=="internal-pairs" else points[:,1]
    g.require(xvalues.min()>=radius and yvalues.min()>=radius and xvalues.max()+radius<frame.shape[1]
              and yvalues.max()+radius<frame.shape[0],"finite search extent")
    if model["method"]=="internal-pairs":
        p=model["pairs"]; a=gray(frame)
        values=np.stack([a[p[:,1]+dy,p[:,0]+dx]-a[p[:,3]+dy,p[:,2]+dx] for dx,dy in offsets])
    else:
        xy=model["xy"]
        values=np.stack([frame[xy[:,1]+dy,xy[:,0]+dx,:3].astype(np.float64) for dx,dy in offsets])
        values=(values-values.mean(axis=1,keepdims=True)).reshape(len(offsets),-1)
    scores=np.clip((values*ref).sum(axis=1)/np.maximum(np.linalg.norm(values,axis=1)*np.linalg.norm(ref),1e-12),-1,1)
    best=max(range(len(offsets)),key=lambda i:(scores[i],-abs(offsets[i][0])-abs(offsets[i][1])))
    dx,dy=offsets[best]
    gap=float(scores[best]-max(scores[i] for i,o in enumerate(offsets) if o!=(dx,dy)))
    energy=float(np.linalg.norm(values[best])/np.linalg.norm(ref))
    reasons=[]
    if max(abs(dx),abs(dy))>params["maximumOffset"]: reasons.append("POSITION_DRIFT")
    if scores[best]<params["minimumCorrelation"]: reasons.append("PATTERN_INSTABILITY")
    if energy<params["energyRatio"][0]: reasons.append("SIGNAL_LOSS")
    if energy>params["energyRatio"][1]: reasons.append("ENERGY_CHANGE")
    if gap<params["minimumPeakGap"] or max(abs(dx),abs(dy))==radius: reasons.append("UNRESOLVED_SEARCH")
    return {"reasons":reasons,"globalOffset":[dx,dy],"correlation":float(scores[best]),"zeroCorrelation":float(scores[offsets.index((0,0))]),"energy":energy,"gap":gap}


def build_all(samples,box,support,manifest):
    start=time.perf_counter()
    models,details=gradient_references(samples,box,support,manifest["methods"],manifest["parameterGrid"])
    shared_ms=(time.perf_counter()-start)*1000
    for method in ["internal-pairs","masked-ncc"]:
        t=time.perf_counter()
        models[method],count=independent_reference(samples,support,method,manifest["parameterGrid"])
        details[method]={"signalCount":count,"observable":models[method] is not None,"buildMs":(time.perf_counter()-t)*1000}
    for method in models:
        details[method].setdefault("buildMs",shared_ms)
        model=models[method]
        details[method]["modelArrayBytes"]=sum(v.nbytes for v in model.values() if isinstance(v,np.ndarray)) if model else 0
    return models,details


def measure(frame,model,manifest):
    if model is None:
        return {"status":"UNOBSERVABLE","reasons":["REFERENCE_UNOBSERVABLE"]}
    if "method" in model:
        result=independent_measure(frame,model,manifest["parameterGrid"]["independentAlignment"])
    else:
        result=g.measure_frame(frame,model)
    return {**result,"status":"ISSUE" if result["reasons"] else "SUPPORTED"}


def evaluate_case(samples,frames,box,support,manifest):
    models,details=build_all(samples,box,support,manifest)
    for name,model in models.items():
        start=time.perf_counter()
        observations=[measure(f,model,manifest) for f in frames]
        details[name].update(status="UNOBSERVABLE" if model is None else "ISSUE" if any(r["status"]=="ISSUE" for r in observations) else "SUPPORTED",
                             measurements=observations,perFrameMs=(time.perf_counter()-start)*1000/len(frames))
    return details


def original_landmarks(reference,roi,support,mask,unpadded,box):
    outside_distance=cv2.distanceTransform((~support).astype(np.uint8),cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    c7,c3=occupancy(support,7),occupancy(support,3)
    def inside(x,y,b): return b["x"]<=x<b["x"]+b["width"] and b["y"]<=y<b["y"]+b["height"]
    rows=[]
    for landmark in reference["landmarks"]:
        sx,sy=landmark["sourceX"],landmark["sourceY"]; x,y=sx-roi["x"],sy-roi["y"]
        rows.append({**landmark,"centerInSupport":bool(support[y,x]),"distanceToSupport":float(outside_distance[y,x]),
                     "coverage7":float(c7[y,x]),"coverage3":float(c3[y,x]),"candidateMaskMembership":bool(mask[y,x]),
                     "unpaddedBoxMembership":inside(sx,sy,unpadded),"sourceBoxMembership":inside(sx,sy,box)})
    hist=lambda key:{f"{a}-{b}":sum(a<=r[key]<b for r in rows) for a,b in [(0,.25),(.25,.5),(.5,.75),(.75,1),(1,1.000001)]}
    return {"count":len(rows),"centerInSupport":sum(r["centerInSupport"] for r in rows),
        "insideUnpaddedOutsideSupport":sum(r["unpaddedBoxMembership"] and not r["centerInSupport"] for r in rows),
        "paddingOnly":sum(r["sourceBoxMembership"] and not r["unpaddedBoxMembership"] for r in rows),
        "outsideSourceBox":sum(not r["sourceBoxMembership"] for r in rows),"candidateMaskMembership":sum(r["candidateMaskMembership"] for r in rows),
        "coverage7Histogram":hist("coverage7"),"coverage3Histogram":hist("coverage3"),
        "coverage7Quantiles":np.quantile([r["coverage7"] for r in rows],[0,.25,.5,.75,1]).tolist(),"rows":rows}


def pictures(root,frame,support,distance,mask,reference,roi,eligible):
    panels=[]
    original=frame[...,:3]
    def overlay(bits,color):
        a=original.copy();a[bits]=np.rint(a[bits]*.35+np.array(color)*.65).astype(np.uint8);return a
    boundary=support & (distance==0)
    panels.append(("original ROI",original))
    panels.append(("M1 mapped footprint (not segmentation)",overlay(support,[20,255,80])))
    panels.append(("support boundary",overlay(boundary,[255,50,20])))
    heat=cv2.applyColorMap(np.rint(np.maximum(distance,0)/max(1,distance.max())*255).astype(np.uint8),cv2.COLORMAP_TURBO)[...,::-1]
    heat[~support]=0;panels.append(("Chebyshev boundary distance",heat))
    a=Image.fromarray(original);draw=ImageDraw.Draw(a)
    for p in reference["landmarks"]:
        x,y=p["sourceX"]-roi["x"],p["sourceY"]-roi["y"]
        draw.point((x,y),fill=(20,255,80) if support[y,x] else (255,20,220))
    panels.append(("v2 landmarks: green owned / magenta outside",np.array(a)))
    panels.append(("strict7 eligible persistent anchors",overlay(eligible,[255,255,0])))
    panels.append(("3395px conservative mask: DISPLAY ONLY",overlay(mask,[30,170,255])))
    w,h=frame.shape[1]*5,frame.shape[0]*5
    sheet=Image.new("RGB",(w*2,(h+35)*4),"#202020");d=ImageDraw.Draw(sheet)
    for i,(label,arr) in enumerate(panels):
        Image.fromarray(arr).save(root/f"roi-{i+1}.png")
        x,y=(i%2)*w,(i//2)*(h+35)
        sheet.paste(Image.fromarray(arr).resize((w,h),Image.Resampling.NEAREST),(x,y+35));d.text((x+5,y+8),label,fill="white")
    sheet.save(root/"support-diagnostic-contact.png")


def run(args):
    output=args.output;output.mkdir(mode=0o700,exist_ok=False)
    manifest=load(METHOD_FILE)
    r=args.evidence
    previous=r/"m2a-static-20261002-app-engine"
    input_path=r/"m1a-discovery-20261002-final/input.json"
    input_doc=load(input_path);source=Path(input_doc["sourcePath"])
    target=load(previous/"target-evidence.json");candidate=load(previous/"candidate.json")["receipt"]
    confirmation=load(previous/"confirmation.json")
    roi=target["roi"];bindings=candidate["frames"]
    fixtures=Path(__file__).resolve().parents[1]/"tests/fixtures"
    support_path=fixtures/"static-real-component-support.json"
    descriptor=load(support_path)
    small=args.small_source
    old_constructor=r/"m2hc-20261004/pre-fix-components.py"
    paths=[Path(__file__),METHOD_FILE,Path(g.__file__),Path(g.replay.__file__),Path(support_kernel.__file__),Path(components.__file__),
           support_path,fixtures/"static-padded-support-counterexamples.npz",fixtures/"static-component-counterexamples.npz",input_path,
           previous/"target-evidence.json",previous/"candidate.json",previous/"confirmation.json",
           r/"m2c-geometry-20261002-accounted-final/landmark-reference.json",old_constructor,source,args.ffmpeg,small]
    frozen={str(p):g.file_sha(p) for p in paths}
    g.require(frozen[str(source)]==input_doc["source"]["fingerprint"].removeprefix("sha256:"),"source SHA")
    g.require(len(bindings)==6990 and len(candidate["anomalies"])==133,"historical complete denominator")
    g.require(frozen[str(args.ffmpeg)]=="f8e3453ae7b5681ad659d880a9b58b1afe87c0952e94c5db4023cdb2a8816a2d","canonical FFmpeg")
    write(output,"research-method-freeze.json",{**manifest,"files":frozen,"dependencies":{"numpy":np.__version__,"opencv":cv2.__version__},
            "sourceBinding":input_doc["source"],"roi":roi,"wallSeconds":1800,"parameterRevisionsAfterObservation":0})
    support=support_kernel.support_raster(descriptor,roi)
    morph,distance=morphology(support)
    bits=np.unpackbits(np.frombuffer(base64.b64decode(descriptor["dataBase64"]),np.uint8),bitorder="little")[:202*360].reshape(360,202)
    gy,gx=np.where(bits)
    unpadded={"x":int(np.floor(gx.min()*720/202)),"y":int(np.floor(gy.min()*1280/360)),
              "width":int(np.ceil((gx.max()+1)*720/202)-np.floor(gx.min()*720/202)),
              "height":int(np.ceil((gy.max()+1)*1280/360)-np.floor(gy.min()*1280/360))}
    maskdoc=candidate["mask"]
    mb=maskdoc["bbox"]
    packed_mask=np.unpackbits(np.frombuffer(base64.b64decode(maskdoc["dataBase64"]),np.uint8),bitorder="little")[:mb["width"]*mb["height"]].reshape(mb["height"],mb["width"])
    allmask=np.zeros((1280,720),np.uint8)
    allmask[mb["y"]:mb["y"]+mb["height"],mb["x"]:mb["x"]+mb["width"]]=packed_mask
    mask=allmask[roi["y"]:roi["y"]+roi["height"],roi["x"]:roi["x"]+roi["width"]].astype(bool)
    reference=load(r/"m2c-geometry-20261002-accounted-final/landmark-reference.json")
    attribution=original_landmarks(reference,roi,support,mask,unpadded,confirmation["sourceBox"])
    write(output,"support-morphology.json",{**morph,"gridCells":int(bits.sum()),"gridBox":[int(gx.min()),int(gy.min()),int(np.ptp(gx)+1),int(np.ptp(gy)+1)],"unpaddedBox":unpadded,"supportDigest":descriptor["supportDigest"]})
    write(output,"original-landmark-attribution.json",attribution)
    deadline=time.monotonic()+1800
    samples=[]
    g.replay.decode(source,args.ffmpeg,roi,[b for b in bindings if b["index"] in candidate["sampleOrdinals"]],input_doc["source"]["timeBase"],lambda f,b:samples.append(f.copy()),deadline)
    samples=np.stack(samples)
    models,details=build_all(samples,{**confirmation["sourceBox"],"x":confirmation["sourceBox"]["x"]-roi["x"],"y":confirmation["sourceBox"]["y"]-roi["y"]},support,manifest)
    write(output,"reference-diagnostics.json",details)
    eligible=np.zeros_like(support)
    for x,y in details["strict7"]["eligibleXY"]:eligible[y,x]=True
    pictures(output,samples[0],support,distance,mask,reference,roi,eligible)
    old=set(a["index"] for a in candidate["anomalies"])
    sums={n:{"status":"UNOBSERVABLE" if m is None else "SUPPORTED","frameCount":0,"issueOrdinals":[],"oldRgbIssueOrdinals":[],"reasonCounts":{},"measureMs":0.0,"minimumCorrelation":None,"minimumGap":None,"maxAbsOffset":0} for n,m in models.items()}
    stream=(output/"real-frame-measurements.jsonl").open("w")
    def consume(frame,binding):
        row={"index":binding["index"],"pts":binding["pts"],"endPts":binding["endPts"],"pixelSha256":binding["pixelSha256"],"oldRgbAnomaly":binding["index"] in old,"methods":{}}
        for name,model in models.items():
            t=time.perf_counter();v=measure(frame,model,manifest);s=sums[name];s["measureMs"]+=(time.perf_counter()-t)*1000;s["frameCount"]+=1
            row["methods"][name]=v
            if v["status"]=="ISSUE":
                s["status"]="ISSUE";s["issueOrdinals"].append(binding["index"])
                if binding["index"] in old:s["oldRgbIssueOrdinals"].append(binding["index"])
                for reason in v["reasons"]:s["reasonCounts"][reason]=s["reasonCounts"].get(reason,0)+1
            if model is not None:
                corr=v.get("correlation",v.get("globalAlignment",{}).get("correlation"))
                gap=v.get("gap",v.get("globalAlignment",{}).get("distinctPeakGap"))
                s["minimumCorrelation"]=corr if s["minimumCorrelation"] is None else min(corr,s["minimumCorrelation"])
                s["minimumGap"]=gap if s["minimumGap"] is None else min(gap,s["minimumGap"])
                s["maxAbsOffset"]=max(s["maxAbsOffset"],max(map(abs,v["globalOffset"])))
        stream.write(json.dumps(row,separators=(",",":"))+"\n")
        if binding["index"]%1000==0:print("real frames",binding["index"],flush=True)
    start=time.perf_counter()
    try:g.replay.decode(source,args.ffmpeg,roi,bindings,input_doc["source"]["timeBase"],consume,deadline)
    finally:stream.close()
    real_seconds=time.perf_counter()-start
    for n,s in sums.items():s["perFrameMs"]=s["measureMs"]/s["frameCount"];s["reference"]=details[n]
    write(output,"real-results.json",sums)
    padded=np.load(fixtures/"static-padded-support-counterexamples.npz")
    box={"x":12,"y":12,"width":58,"height":44};ps=padded["support_source"][478:546,266:348].astype(bool)
    padding={}
    for case in ["move","disappear","price"]:
        frames=padded[case][:,478:546,266:348]
        padding[case]=evaluate_case(frames[[0,0,2,2]],frames,box,ps,manifest)
    write(output,"padding-results.json",padding)
    # Old NPZ has no detector bitmap. Preserve byte-identical v1/v2 replay and
    # report the missing candidate-domain evidence, rather than filling boxes.
    ce=np.load(fixtures/"static-component-counterexamples.npz");old_results=[]
    for original,changed in [("frame","move"),("frame","lost"),("weak","shift")]:
        baseline=g.build_model(np.stack([ce[original]]*4),{"x":20,"y":30,"width":208,"height":60})
        states=[]
        for b in [{"x":20,"y":30,"width":60,"height":60},{"x":220,"y":52,"width":8,"height":8}]:
            try:m=components.build_component_model(np.stack([ce[original]]*4),b);states.append(measure(ce[changed],m,manifest)["status"])
            except ValueError:states.append("UNOBSERVABLE")
        old_results.append({"case":changed,"v1":measure(ce[changed],baseline,manifest)["status"],"v2Components":states,
                            "candidateMethods":"NOT_EVALUATED","reason":"frozen NPZ has no M1 component membership; bbox fill/intensity-derived surrogate not authorized"})
    write(output,"old-component-results.json",old_results)
    # Supplemental domain is the EXACT B contribution explicitly written by
    # the archived constructor (54:58,222:226), not its padded 8x8 box or M1.
    # This observes B only; an unobservable required B blocks ALL-components.
    constructor=old_constructor.read_text()
    g.require("frame[54:58,222:226,:3]=170" in constructor and "weak[54:58,222:226,:3]=133" in constructor,
              "frozen old detached construction assignment")
    b_support=np.zeros(ce["frame"].shape[:2],bool);b_support[54:58,222:226]=True
    old_detached={}
    for original,changed in [("frame","move"),("frame","lost"),("weak","shift")]:
        old_detached[changed]={"supportProvenance":"ARCHIVED_CONSTRUCTION_B_PIXELS_NOT_M1", "supportPixels":16,
            "methods":evaluate_case(np.stack([ce[original]]*4),[ce[original],ce[changed]],
                    {"x":220,"y":52,"width":8,"height":8},b_support,manifest)}
    write(output,"old-detached-construction-results.json",old_detached)
    rng=np.random.default_rng(17);base=np.full((80,100,4),90,np.uint8);base[...,3]=255
    texture=cv2.GaussianBlur(rng.integers(45,205,(44,60),dtype=np.uint8),(3,3),.5)
    base[18:62,20:80,:3]=texture[...,None];cs=np.zeros((80,100),bool);cs[18:62,20:80]=True
    controls={"stable":base.copy(),"disappear":base.copy()};controls["disappear"][18:62,20:80,:3]=90
    for dx,dy in manifest["parameterGrid"]["controls"]["translations"]:
        controls[f"move{dx},{dy}"]=cv2.warpAffine(base,np.float32([[1,0,dx],[0,1,dy]]),(100,80),borderMode=cv2.BORDER_REPLICATE)
    noise=np.random.default_rng(5).integers(-2,3,base[...,:3].shape)
    for name,delta in [("noise",noise),("channel-bias",np.array([-30,20,15]))]:
        f=base.copy();f[...,:3]=np.clip(f[...,:3].astype(np.int16)+delta,0,255);controls[name]=f
    bg=base.copy();bg[~cs,:3]=180;controls["changing-background"]=bg
    control_results={case:evaluate_case(np.stack([base]*4),[f],{"x":20,"y":18,"width":60,"height":44},cs,manifest) for case,f in controls.items()}
    write(output,"controls-results.json",control_results)
    # Exact same M2-G decoded source; construction-owned 4x4 support is explicit.
    import subprocess
    data=subprocess.run([str(args.ffmpeg),"-v","error","-threads","1","-i",str(small),"-vf","select='eq(n,0)+eq(n,10)+eq(n,19)+eq(n,29)'","-fps_mode","passthrough","-pix_fmt","rgba","-f","rawvideo","pipe:1"],capture_output=True,check=True,timeout=60).stdout
    small_frames=np.frombuffer(data,np.uint8).reshape(4,96,128,4)
    ss=np.zeros((96,128),bool);ss[41:45,83:87]=True
    small_results=evaluate_case(small_frames,small_frames,{"x":81,"y":39,"width":8,"height":8},ss,manifest)
    write(output,"small-island-results.json",small_results)
    after={str(p):g.file_sha(p) for p in paths}
    g.require(after==frozen,"input drift")
    write(output,"input-freshness.json",{"unchanged":True,"files":after,"modelRequests":0,"authority":"none","eligible":False})
    write(output,"performance.json",{"realFullRangeSeconds":real_seconds,"sharedRepresentativeArrayBytes":samples.nbytes,
          "extraFullRangeDecode":True,"decodePasses":2,"fullFrameSpool":False,
          "peakTemporaryBytes":"NOT_MEASURED; model array sizes and representative stack reported separately", "methods":{n:{"buildMs":details[n]["buildMs"],"perFrameMs":sums[n]["perFrameMs"],"modelArrayBytes":details[n]["modelArrayBytes"]} for n in models}})
    print(json.dumps({n:{"status":s["status"],"issues":len(s["issueOrdinals"]),"oldRgbIssues":len(s["oldRgbIssueOrdinals"]),"reference":details[n]} for n,s in sums.items()},indent=2),flush=True)


def self_check():
    square=np.zeros((11,11),bool);square[3:8,3:8]=True
    m,_=morphology(square)
    assert m["perimeterExposedPixelEdges"]==20 and m["boundaryPixels"]==16
    assert m["distanceAtLeast"]=={"0":25,"1":9,"2":1,"3":0,"4":0}
    assert occupancy(square,3)[5,5]==1 and occupancy(square,7)[5,5]==25/49
    pairs=pair_coordinates(square,[1,2,3])
    assert len(pairs)==2*(5*4+5*3+5*2)
    for x,y,a,b in pairs:
        assert square[y,x] and square[b,a]
        assert square[min(y,b):max(y,b)+1,min(x,a):max(x,a)+1].all()
    hollow=square.copy();hollow[5,5]=False
    assert not any((x==4 and y==5 and a==6 and b==5) for x,y,a,b in pair_coordinates(hollow,[2]))
    # A uniform owned island cannot borrow exterior edges for internal contrast.
    frame=np.full((11,11,4),90,np.uint8);frame[~square,:3]=220;frame[...,3]=255
    params=load(METHOD_FILE)["parameterGrid"]
    model,count=independent_reference(np.stack([frame]*4),square,"internal-pairs",params)
    assert count==len(pairs) and model is None
    assert independent_reference(np.stack([frame]*4),square,"masked-ncc",params)[0] is None
    # Finite search fails before NumPy negative indexing can wrap to background.
    model={"method":"masked-ncc","xy":np.array([[0,0],[1,1]]),"reference":np.ones(6)}
    try:independent_measure(frame,model,params["independentAlignment"])
    except ValueError as error:assert "finite search extent" in str(error)
    else:raise AssertionError("search should reject edge overflow")
    print("self-check: 8 morphology/occupancy/pair ownership/holes/uniform-island/search controls PASS")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check",action="store_true")
    parser.add_argument("--evidence",type=Path)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--ffmpeg",type=Path)
    parser.add_argument("--small-source",type=Path)
    args=parser.parse_args()
    if args.self_check:self_check()
    else:
        if any(v is None for v in [args.evidence,args.output,args.ffmpeg,args.small_source]):parser.error("research run requires all four path arguments")
        run(args)
