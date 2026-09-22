# Batch Video Production Agent Playbook

## Purpose

本文档把"追加批量商品视频"的完整操作手把手固化下来,供另一台电脑上的 Agent 照着执行。它是 [batch-video-production-runbook.md](batch-video-production-runbook.md) 的操作层补充:runbook 定义合同与边界,本文给出每一步的具体命令、脚本、验证门禁和换机适配清单。

适用场景:同一产品已有**已完成(completed)的导出批次**可以作为冻结模板来源,在不重新调用模型的情况下追加一批新视频(Path B)。如果目标机器上该产品从来没有完成过任何批次,必须先看 §11(Path A / 迁移),不能照搬本文脚本。

## Hard Constraints

以下约束来自 AGENTS.md,违反任何一条都算失败,不能用"结果看起来没问题"补救:

1. **展示文字必须由用户手工给出**,原样使用。Agent 不得推测、生成或改写价格/数量/产品名。开始执行前先向用户要到每个产品的展示文字。
2. **不得覆盖已有文件**。输出目录按 `<产品目录>/视频/M.D HH:mm` 新建,重名追加 ` (2)`、` (3)`。不得删除或替换用户已有的任何视频、目录、项目文件。
3. **不得伪造完成状态**。成片必须由应用的 `ExportQueue` 实际渲染并验证;准备脚本只负责建立 `interrupted` 任务,绝不能把自己拼的 MP4 标记为 completed。
4. **覆盖轨迹与普通四角几何不得改动**。克隆时只允许:换新 ID、改文字层内容与 `productPrice`、设置时序模式、改输出目录、随机化覆盖层贴纸资源。覆盖框、关键帧、起止时间、白色底板策略、普通四角位置一律不动;用摘要(digest)证明没动。
5. **没有覆盖轨迹的模板不伪造覆盖层**(例如滴耳康历史模板就是纯四角贴纸)。
6. **Path B 不调用任何模型**,不需要 API Key;`retryExport` 只做本地 FFmpeg 渲染。
7. **完成声明必须基于新鲜验证证据**:队列状态 + 磁盘文件集 + 全量 ffprobe + 抽样画面,缺一不可。抽样截图不等于全部成片验收,交付时必须写明这一点。
8. **与用户的交互应用共存**:worker 使用独立 `userData`、独立端口,不读写 `/home/<user>/.config/jianji`,不影响用户正在用的应用实例。

## Prerequisites

目标机器上先确认:

| 依赖 | 检查命令 | 说明 |
| --- | --- | --- |
| jianji 仓库 + 依赖 + 构建产物 | `ls <repo>/dist-electron/main.cjs <repo>/node_modules/electron/dist/electron` | 必须与产生源批次时相同版本的代码;checkout 到同一 commit 后 `npm install && npm run build`(以仓库 README 为准) |
| FFmpeg / FFprobe | `ls ~/.config/jianji/tools/ffmpeg/bin/{ffmpeg,ffprobe}` | 应用探测顺序见 README;也可用 `JIANJI_FFMPEG_PATH`/`JIANJI_FFPROBE_PATH` 显式指定,两个必须同时设置 |
| python3 / jq / curl | `python3 -V && jq --version && curl --version` | setup 脚本和监控依赖 |
| 素材与贴纸资源 | 见 §3 | 源视频文件、贴纸 PNG、字体必须与源批次记录的路径和指纹一致 |
| 可用端口 | 每个 worker 一个(如 9541-9545) | `(echo > /dev/tcp/127.0.0.1/9541) 2>/dev/null && echo OCCUPIED \|\| echo free` |

## Machine Layout

以最近一轮真实生产为例的路径约定(**换机时必须全部替换成本机实际路径**):

```text
repo:           /home/reggie/vscode_folder/jianji
run artifacts:  /home/reggie/jianji-output/<批次名>-<时间戳>/
素材与输出:      /home/reggie/电商/<产品>/{素材,视频}/
ffmpeg:         /home/reggie/.config/jianji/tools/ffmpeg/bin/
```

产品与展示文字(**以下只是历史记录,新一轮必须让用户重新确认**):

| Product key | 产品 | 素材/输出父目录 | 历史展示文字 |
| --- | --- | --- | --- |
| hudie | 蝴蝶贴 | `/home/reggie/电商/蝴蝶贴` | `19.9元30贴` |
| antang | 氨糖膏 | `/home/reggie/电商/氨糖膏` | `19.9元2支` |
| mayou | 马油 | `/home/reggie/电商/马油膏布` | `9.9元到手5卷` 换行 `19.9元拍一发三` |
| feizao | 肥皂 | `/home/reggie/电商/肥皂` | `19.9元拍一发三` |
| dierkang | 滴耳康 | `/home/reggie/电商/滴耳康` | `19.9元拍一发三` |

时序合同(当前用户习惯):`decorationDisplayMode: "first-5s"`(文字前 5 秒,最后 0.5 秒渐隐)+ `stickerDisplayMode: "full"`(贴纸全程)。输出默认 720p、保留原帧率、等比缩放补边、不裁剪。

## Step 0: Collect Eligible Source Batches

找出本机所有包含该产品**精确源素材**的已完成批次的项目文件。一个 run root 的结构:

```text
<run-root>/<worker>/
  <项目名>.jianji-project.json      # exportBatches 里有冻结模板
  .app-profile/jobs/<batch-id>.json # 队列持久化真相
  .app-profile/agent-stickers/      # 贴纸资源
  .app-profile/connections/         # 模型连接(Path B 不用,但为了可打开项目照常复制)
  .app-profile/source-sticker-knowledge/
```

合格批次必须同时满足(setup 脚本会自动过滤和断言):

- `batch.status == "completed"` 且 `batch.tasks[0].status == "completed"`
- `mediaSnapshots[0].sourcePath` 文件仍存在
- 模板引用的贴纸 `assetPath` 文件仍存在
- 需要覆盖层复用时,模板来自同一精确源素材(脚本按 `sourcePath` 分组保证)

把候选 worker 目录列进 setup 脚本的 `sources` 字典,越多越好——池子越大,新批次四角搭配越不重复。

## Step 1: Setup Script (Clone And Freeze)

下面就是最近一轮 5×70 实际使用的脚本,原样可用;**需要适配的点在 §10 清单**。把它存为 `setup_repeat.py` 后用 `python3` 执行。它做的事情:

1. 从 `sources` 里读所有项目,按 `sourcePath` 分组收集合格批次。
2. 新随机种子打乱素材顺序,按 phase 旋转后轮询选 70 个版本(同一素材不会连续出现)。
3. 每个版本深拷贝一个冻结批次:全部换新 ID;文字层和 `productPrice` 设为本轮展示文字;`decorationDisplayMode="first-5s"`、`stickerDisplayMode="full"`;指向新输出目录;任务初始化为 `interrupted`。
4. 覆盖层贴纸从贴纸池平衡随机(同版本内不重复、全局用量尽量均匀),替换前后对去掉 ID/资源字段的层数据算 SHA-256,**摘要必须完全相同**以证明几何未动。
5. 写出:worker 目录、`.app-profile/jobs/*.json`、新项目文件、`random-sticker-selections.json`、Electron 启动/监控运行时、`production-plan.json`。

```python
#!/usr/bin/env python3
import copy, datetime as dt, hashlib, json, os, random, shutil, uuid
from pathlib import Path

# ===== 换机必改:路径、来源 worker、产品规格、端口、核数 =====
REPO=Path('/home/reggie/vscode_folder/jianji')
R4=Path('/home/reggie/jianji-output/再次4x70-20260920-000525')  # 任一含 randomizedStickerUsage 的历史 plan,用于取贴纸池
r4_plan=json.loads((R4/'production-plan.json').read_text(encoding='utf-8'))
stamp=dt.datetime.now().strftime('%Y%m%d-%H%M%S')
display=dt.datetime.now().strftime('%-m.%-d %H:%M')
ROOT=Path(f'/home/reggie/jianji-output/再次批次-{stamp}')
seed=int.from_bytes(os.urandom(16),'big'); rng=random.Random(seed)

def load_worker(root):
    root=Path(root)
    files=[p for p in root.glob('*.jianji-project.json')]
    assert len(files)==1, f'{root}: expected 1 project file, got {len(files)}'
    return json.loads(files[0].read_text(encoding='utf-8')), root

# 每个产品:所有历史已完成 worker 目录
sources={
 'hudie-70':[load_worker('/home/reggie/jianji-output/保存项目5x70-20260919-151819/hudie-1-70'),
             load_worker('/home/reggie/jianji-output/保存项目5x70-20260919-151819/hudie-2-70'),
             load_worker('/home/reggie/jianji-output/再次4x70-20260920-000525/hudie-70')],
 # 'antang-70': [...], 'mayou-70': [...], 'feizao-70': [...], 'dierkang-70': [...],
}
# 展示文字必须来自用户当轮手工确认
specs={
 'hudie-70':{'product':'蝴蝶贴','price':'19.9元30贴','parent':'/home/reggie/电商/蝴蝶贴/视频','port':9541,'cpus':'0-3','phase':5},
 # ...每个产品一项;phase 各不同,避免与上一轮选中同一批版本
}
FFMPEG_ENV='JIANJI_FFMPEG_PATH=/home/reggie/.config/jianji/tools/ffmpeg/bin/ffmpeg JIANJI_FFPROBE_PATH=/home/reggie/.config/jianji/tools/ffmpeg/bin/ffprobe'
# ===== 适配区结束 =====

sticker_ids=sorted(r4_plan['randomizedStickerUsage'])
asset_map={}
for plist in sources.values():
 for project,_ in plist:
  for batch in project['exportBatches']:
   for layer in batch['templateSnapshot']['layers']:
    if layer.get('type')!='sticker':continue
    sid=(layer.get('cover') or {}).get('stickerId') or 'uploaded-'+Path(layer['assetPath']).stem
    if sid in sticker_ids:asset_map[sid]={'assetPath':layer['assetPath'],'assetFingerprint':layer['assetFingerprint']}
assert set(asset_map)==set(sticker_ids), '贴纸池与来源项目不匹配,改用来源项目里实际出现的 cover stickerId 集合作为 sticker_ids'
assert all(Path(v['assetPath']).is_file() for v in asset_map.values()), '贴纸资源缺失,停止;不得用同名文件冒充'

class Picker:
 def __init__(self):self.pool=sticker_ids[:];rng.shuffle(self.pool);self.i=0
 def pick(self,excluded):
  for _ in range(200):
   if self.i>=len(self.pool):rng.shuffle(self.pool);self.i=0
   value=self.pool[self.i];self.i+=1
   if value not in excluded:return value
  raise RuntimeError('picker exhausted')
picker=Picker(); usage={sid:0 for sid in sticker_ids}

def output_dir(parent):
 p=Path(parent)/display;n=2
 while p.exists():p=Path(parent)/f'{display} ({n})';n+=1
 p.mkdir(parents=True);return p

def select(plist,count,phase):
 groups={}
 for project,_ in plist:
  for batch in project['exportBatches']:
   if batch['status']=='completed' and batch['tasks'][0]['status']=='completed':groups.setdefault(batch['mediaSnapshots'][0]['sourcePath'],[]).append(copy.deepcopy(batch))
 order=sorted(groups);rng.shuffle(order);order=order[phase%len(order):]+order[:phase%len(order)]
 for rows in groups.values():rng.shuffle(rows)
 cursors={s:phase%len(groups[s]) for s in order};result=[]
 for i in range(count):
  s=order[i%len(order)];rows=groups[s];result.append(copy.deepcopy(rows[cursors[s]%len(rows)]));cursors[s]+=1
 return result

def digest(layer):
 x=copy.deepcopy(layer);x.pop('id',None);x.pop('assetPath',None);x.pop('assetFingerprint',None)
 if x.get('cover'):x['cover'].pop('stickerId',None)
 return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def runtime_files(runtime,root,project_path,name,port,cpus):
 launch=f"""const {{app,dialog}}=require('electron');
const root={json.dumps(str(root),ensure_ascii=False)};
app.setPath('userData',root+'/.app-profile');app.setPath('documents',root);app.getAppPath=()=>{json.dumps(str(REPO))};process.defaultApp=true;
app.commandLine.appendSwitch('remote-debugging-port',{json.dumps(str(port))});app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
dialog.showOpenDialog=async()=>({{canceled:false,filePaths:[{json.dumps(str(project_path),ensure_ascii=False)}]}});dialog.showSaveDialog=async()=>({{canceled:false,filePath:{json.dumps(str(project_path),ensure_ascii=False)}}});require({json.dumps(str(REPO/'dist-electron/main.cjs'))});
"""
 (runtime/'launch.cjs').write_text(launch,encoding='utf-8')
 cdp=f"""import {{readFile}} from 'node:fs/promises';
const pages=await(await fetch('http://127.0.0.1:{port}/json')).json();const page=pages.find(p=>p.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{{once:true}}));const expression=await readFile(process.argv[2],'utf8');ws.send(JSON.stringify({{id:1,method:'Runtime.evaluate',params:{{expression,awaitPromise:true,returnByValue:true}}}}));ws.addEventListener('message',({{data}})=>{{const m=JSON.parse(data);if(m.id===1){{console.log(JSON.stringify(m.result));ws.close();}}}});
"""
 (runtime/'cdp.mjs').write_text(cdp,encoding='utf-8')
 init=f"""(async()=>{{const loaded=await window.jianji.loadProject();if(!loaded)throw Error('project not loaded');const s=await window.jianji.getState();if(s.project.name!=={json.dumps(name,ensure_ascii=False)})throw Error('wrong project');const ids=s.queue.batches.flatMap(b=>b.batch.tasks).filter(t=>t.status==='interrupted'||t.status==='failed'||t.status==='cancelled').map(t=>t.id);window.__productionError=null;window.__productionDone=false;window.__productionPromise=window.jianji.retryExport(ids).then(()=>{{window.__productionDone=true;}}).catch(e=>{{window.__productionError=String(e);window.__productionDone=true;}});return {{name:s.project.name,requested:70,retrying:ids.length}};}})()"""
 (runtime/'init.js').write_text(init,encoding='utf-8')
 finish=f"""import {{writeFile}} from 'node:fs/promises';
const root={json.dumps(str(root),ensure_ascii=False)},requested=70,port={port};const pages=await(await fetch(`http://127.0.0.1:${{port}}/json`)).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{{once:true}}));let seq=0;const pending=new Map();ws.addEventListener('message',({{data}})=>{{const m=JSON.parse(data);if(m.id){{const p=pending.get(m.id);pending.delete(m.id);m.result?.exceptionDetails?p.reject(Error(m.result.exceptionDetails.text)):p.resolve(m.result.result.value)}}}});const run=expression=>new Promise((resolve,reject)=>{{const id=++seq;pending.set(id,{{resolve,reject}});ws.send(JSON.stringify({{id,method:'Runtime.evaluate',params:{{expression,awaitPromise:true,returnByValue:true}}}}))}});let last='';try{{for(;;){{const s=await run('window.jianji.getState()');const tasks=s.queue.batches.flatMap(b=>b.batch.tasks);const done=tasks.filter(t=>t.status==='completed');const bad=tasks.filter(t=>['failed','cancelled'].includes(t.status));const active=tasks.filter(t=>!['completed','failed','cancelled'].includes(t.status));const summary={{at:new Date().toISOString(),requested,completed:done.length,active:active.length,failedCount:bad.length,runtimeDone:await run('window.__productionDone'),runtimeError:await run('window.__productionError')}};await writeFile(root+'/live-status.json',JSON.stringify(summary,null,2));const text=JSON.stringify({{...summary,at:undefined}});if(text!==last){{console.log(JSON.stringify(summary));last=text}}if(done.length===requested){{await writeFile(root+'/completed-tasks.json',JSON.stringify(done,null,2));console.log('ALL_COMPLETED '+requested);break}}if(summary.runtimeDone&&(bad.length||summary.runtimeError))throw Error(summary.runtimeError||('render failures: '+bad.length));await new Promise(r=>setTimeout(r,10000));}}}}catch(error){{await writeFile(root+'/production-blocker-current.json',JSON.stringify({{error:String(error),at:new Date().toISOString()}}));console.log('BLOCKED '+String(error));process.exitCode=1}}finally{{ws.close()}};
"""
 (runtime/'finish.mjs').write_text(finish,encoding='utf-8')
 # 注意:env -u ELECTRON_RUN_AS_NODE 必须保留,见 §9 gotchas
 run=f"""#!/usr/bin/env bash
set -euo pipefail
root={json.dumps(str(root),ensure_ascii=False)}
runtime={json.dumps(str(runtime),ensure_ascii=False)}
port={port}
cd {json.dumps(str(REPO))}
env -u ELECTRON_RUN_AS_NODE {FFMPEG_ENV} taskset -c {cpus} node_modules/electron/dist/electron "$runtime/launch.cjs" > "$root/electron.log" 2>&1 &
pid=$!;echo "$pid" > "$root/electron.pid";cleanup() {{ kill "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true; }};trap cleanup EXIT
for _ in $(seq 1 120);do if curl -fsS "http://127.0.0.1:$port/json" 2>/dev/null | jq -e 'any(.[]; .type == "page")' >/dev/null;then break;fi;if ! kill -0 "$pid" 2>/dev/null;then tail -n 80 "$root/electron.log";exit 1;fi;sleep 1;done
curl -fsS "http://127.0.0.1:$port/json" | jq -e 'any(.[]; .type == "page")' >/dev/null
node "$runtime/cdp.mjs" "$runtime/init.js";node "$runtime/finish.mjs"
"""
 (runtime/'run-worker.sh').write_text(run,encoding='utf-8');os.chmod(runtime/'run-worker.sh',0o755)

ROOT.mkdir(parents=True);workers=[]
for key,spec in specs.items():
 root=ROOT/key;profile=root/'.app-profile';jobs=profile/'jobs';runtime=Path(f'/tmp/jianji-batch-{stamp}-{key}')
 root.mkdir();jobs.mkdir(parents=True);runtime.mkdir(parents=True);out=output_dir(spec['parent'])
 profile_source=next(r for _,r in sources[key] if (r/'.app-profile').exists())/'.app-profile'
 for folder in ['connections','agent-stickers','source-sticker-knowledge']:
  if (profile_source/folder).exists():shutil.copytree(profile_source/folder,profile/folder)
 selected=select(sources[key],70,spec['phase']);base=copy.deepcopy(sources[key][0][0]);project_id=str(uuid.uuid4());now=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
 media_map={}
 for project,_ in sources[key]:
  for media in project['mediaItems']:media_map[media['sourcePath']]=copy.deepcopy(media)
 selected_sources=sorted({b['mediaSnapshots'][0]['sourcePath'] for b in selected});records=[];new_batches=[]
 for index,batch in enumerate(selected,1):
  old_id=batch['id'];source=batch['mediaSnapshots'][0]['sourcePath'];assert Path(source).is_file();batch_id=str(uuid.uuid4());task_id=str(uuid.uuid4());template=batch['templateSnapshot'];template['id']=str(uuid.uuid4());template['createdAt']=template['updatedAt']=now;template['decorationDisplayMode']='first-5s';template['stickerDisplayMode']='full';template['productPrice']=spec['price'];before=[];after=[];chosen=set();ids=[];covers=0;stickers=0
  for layer in template['layers']:
   layer['id']=str(uuid.uuid4())
   if layer.get('type')=='text':layer['content']=spec['price']
   if layer.get('type')!='sticker':continue
   stickers+=1
   if layer.get('cover'):
    covers+=1;before.append(digest(layer));sid=picker.pick(chosen);chosen.add(sid);m=asset_map[sid];layer['assetPath']=m['assetPath'];layer['assetFingerprint']=m['assetFingerprint'];layer['cover']['stickerId']=sid;ids.append(sid);usage[sid]+=1;after.append(digest(layer))
  assert before==after, '覆盖层几何被改动,停止'
  assert template['productPrice']==spec['price'] and all(l.get('content')==spec['price'] for l in template['layers'] if l.get('type')=='text')
  batch['id']=batch_id;batch['projectId']=project_id;batch['templateSnapshot']=template;batch['outputDirectory']=str(out);batch['status']='completed_with_errors';batch['createdAt']=now;batch.pop('submission',None)
  task=batch['tasks'][0];task.clear();task.update({'id':task_id,'batchId':batch_id,'mediaId':batch['mediaIds'][0],'status':'interrupted','progress':0,'attempt':1,'outputPath':str(out/f'.pending-{index:04d}.mp4'),'errorCode':'interrupted','errorMessage':'新批次已准备，等待本地渲染。','createdAt':now,'finishedAt':now,'attempts':[]})
  state={'schemaVersion':2,'revision':1,'batch':copy.deepcopy(batch),'updatedAt':now};(jobs/f'{batch_id}.json').write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8');new_batches.append(batch);records.append({'index':index,'sourceBatchId':old_id,'source':source,'coverCount':covers,'stickerCount':stickers,'randomizedStickerIds':ids,'coverTrackHashes':after})
 base['id']=project_id;base['name']=f"{spec['product']}再次70条文字5秒贴纸全程";base['mediaItems']=[media_map[s] for s in selected_sources];base['exportBatches']=new_batches;base['reviewDrafts']=[];base['updatedAt']=now;project_path=root/f"{base['name']}.jianji-project.json";project_path.write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8');(root/'random-sticker-selections.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8');runtime_files(runtime,root,project_path,base['name'],spec['port'],spec['cpus']);workers.append({'key':key,'product':spec['product'],'requested':70,'output':str(out),'root':str(root),'runtime':str(runtime),'project':str(project_path),'port':spec['port'],'cpus':spec['cpus'],'sources':len(selected_sources)})
plan={'createdAt':dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z'),'seed':seed,'timing':{'decorationDisplayMode':'first-5s','stickerDisplayMode':'full'},'workers':workers,'outputs':[w['output'] for w in workers],'stickerPoolCount':len(sticker_ids),'randomizedStickerUsage':usage}
(ROOT/'production-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8');(ROOT/'setup_repeat.py').write_text(Path(__file__).read_text(encoding='utf-8'),encoding='utf-8');print(json.dumps({'planRoot':str(ROOT),'workers':workers,'usageRange':[min(usage.values()),max(usage.values())]},ensure_ascii=False,indent=2))
```

执行后检查输出:`planRoot`、每个 worker 的输出目录、来源素材数、`usageRange`(覆盖贴纸用量应尽量平坦;没有覆盖层的产品如滴耳康恒为 `[0,0]`,这是正常的)。抽查一个 jobs 文件确认:`status=interrupted`、文字层内容=展示文字、`first-5s`/`full`、贴纸数=4。

## Step 2: Launch Workers

每个 worker 一个后台进程,全部并行;`wait` 等全部结束:

```bash
R=<planRoot>; T=<plan 里任一 worker 的 runtime 前缀>
for k in <worker-key-1> <worker-key-2> ...; do
  bash $T-$k/run-worker.sh > $R/$k/worker.log 2>&1 &
done
wait
```

每个 worker 的流程:启动隔离 Electron(独立 userData、独立 CDP 端口)→ 等 CDP 就绪 → `cdp.mjs` 注入 `init.js` 加载项目并对所有 `interrupted/failed/cancelled` 任务调用 `retryExport` → `finish.mjs` 每 10 秒把进度写进 `live-status.json`,全部完成时写 `completed-tasks.json` 并打印 `ALL_COMPLETED 70`。

监控:

```bash
python3 -c "import json;d=json.load(open('$R/<key>/live-status.json'));print(d['completed'],'/',d['requested'],',',d['failedCount'],'failed')"
```

出现 `production-blocker-current.json` 说明该 worker 失败,读里面的 `error` 再处理,**不得在有 failed 任务的情况下声称成功**。

## Step 3: Failure Recovery

应用/worker 被杀或机器重启后:

1. 确认 `$R/<key>/electron.pid` 里的进程已死;确认端口已释放(`ss -tlnp | grep <port>`)。**杀进程后立刻重启常见端口未释放(electron 日志出现 `bind() failed: Address already in use`),等几秒确认端口空闲再启动。**
2. 直接重新执行同一个 `run-worker.sh`。`init.js` 只会把 `interrupted/failed/cancelled` 的任务交给 `retryExport`;已 completed 且产物有效的任务不动。不删已完成文件、不重建任务。
3. 想给慢 worker 加核:先杀掉它的 electron,改 `run-worker.sh` 里的 `taskset -c` 范围,再按上一步重启。被中断的那一条任务会作为 `interrupted` 重渲;输出目录里可能留下 `.*.partial.mp4` 和 `.jianji-*.txt` 孤儿临时文件,在该任务重渲完成后删除(见 §6 门禁会检查)。

## Step 4: Verification Gate

全部 worker `ALL_COMPLETED` 之后,运行门禁脚本(存为 `verify.py`,执行 `python3 verify.py <planRoot>`)。它做:任务数==请求数且全 completed;每个任务有 `outputArtifact` 且路径在输出目录内;输出目录 MP4 集合与任务产物集合完全一致;无 `.partial`/`.jianji-*` 遗留;对每条成片 ffprobe(H.264、时长与 `mediaSnapshots` 差 ≤500ms、音频有无与源一致、竖版 720×1280/横版 1280×720、文件非空):

```python
#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

ROOT=Path(sys.argv[1])
FFPROBE=str(Path.home()/'.config/jianji/tools/ffmpeg/bin/ffprobe')  # 换机按实际路径
plan=json.loads((ROOT/'production-plan.json').read_text(encoding='utf-8'))

def probe(path):
 r=subprocess.run([FFPROBE,'-v','error','-print_format','json','-show_streams','-show_format',str(path)],capture_output=True,text=True)
 if r.returncode!=0:return None
 return json.loads(r.stdout)

failures=[];checked=0;report={'workers':{}}
for w in plan['workers']:
 root=Path(w['root']);out=Path(w['output']);jobs=root/'.app-profile'/'jobs'
 states=[json.loads(p.read_text(encoding='utf-8')) for p in jobs.glob('*.json')]
 tasks=[(s['batch']['tasks'][0],s['batch']) for s in states]
 wres={'requested':w['requested'],'tasks':len(tasks),'completed':0,'probed':0,'failures':[]}
 if len(tasks)!=w['requested']:wres['failures'].append(f'task count {len(tasks)} != {w["requested"]}')
 artifact_paths=set()
 for task,batch in tasks:
  if task['status']!='completed':wres['failures'].append(f'task {task["id"]} status {task["status"]}');continue
  wres['completed']+=1
  art=task.get('outputArtifact') or {}
  ap=art.get('path') or task.get('outputPath')
  if not ap: wres['failures'].append(f'task {task["id"]} missing outputArtifact');continue
  if Path(ap).parent.resolve()!=out.resolve():wres['failures'].append(f'{ap} outside output dir')
  artifact_paths.add(str(Path(ap).resolve()))
 disk={str(p.resolve()) for p in out.glob('*.mp4')}
 if disk!=artifact_paths:wres['failures'].append(f'file-set mismatch: disk-only={sorted(disk-artifact_paths)[:3]} task-only={sorted(artifact_paths-disk)[:3]}')
 leftovers=list(out.glob('*.partial'))+list(out.glob('.jianji-*'))+list(out.glob('*.jianji-*'))+list(out.glob('.*.partial.mp4'))
 if leftovers:wres['failures'].append(f'temp leftovers: {[str(x) for x in leftovers[:3]]}')
 for task,batch in tasks:
  if task['status']!='completed':continue
  art=task.get('outputArtifact') or {};ap=art.get('path') or task.get('outputPath')
  if not ap or not Path(ap).is_file():continue
  snap=batch['mediaSnapshots'][0];src=snap['sourcePath']
  po=probe(ap);ps=probe(src)
  if po is None:wres['failures'].append(f'ffprobe failed: {ap}');continue
  if ps is None:wres['failures'].append(f'ffprobe failed on source: {src}');continue
  vs=next((s for s in po['streams'] if s['codec_type']=='video'),None)
  if not vs or vs['codec_name']!='h264':wres['failures'].append(f'not h264: {ap}')
  if Path(ap).stat().st_size<=0:wres['failures'].append(f'empty file: {ap}')
  od=float(po['format']['duration'])*1000
  if abs(od-snap['durationMs'])>500:wres['failures'].append(f'duration diff {od-snap["durationMs"]:.0f}ms: {ap}')
  portrait=snap['height']>=snap['width']
  exp=(720,1280) if portrait else (1280,720)
  if (vs['width'],vs['height'])!=exp:wres['failures'].append(f'resolution {vs["width"]}x{vs["height"]} != {exp[0]}x{exp[1]}: {ap}')
  soa=any(s['codec_type']=='audio' for s in ps['streams'])
  ooa=any(s['codec_type']=='audio' for s in po['streams'])
  if soa!=ooa:wres['failures'].append(f'audio mismatch src={soa} out={ooa}: {ap}')
  wres['probed']+=1;checked+=1
 report['workers'][w['key']]=wres
 failures.extend(f"[{w['key']}] {f}" for f in wres['failures'])
report['totalProbed']=checked;report['totalFailures']=len(failures)
(ROOT/'verification-report.json').write_text(json.dumps({'report':report,'failures':failures[:100]},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:{'completed':v['completed'],'probed':v['probed'],'failures':len(v['failures'])} for k,v in report['workers'].items()},ensure_ascii=False,indent=2))
print('TOTAL_PROBED',checked,'TOTAL_FAILURES',len(failures))
for f in failures[:20]:print('FAIL:',f)
sys.exit(1 if failures else 0)
```

门禁红(False/非零退出)时:修复后**重跑整个门禁**,不得只看修好的那几条。

## Step 5: Visual Samples

每个 worker 取第一个批次的成片和源视频,各抽 1.0s 与 5.3s 帧拼对照图,人工(或视觉模型)检查:

```bash
R=<planRoot>; FF=~/.config/jianji/tools/ffmpeg/bin/ffmpeg; mkdir -p $R/visual-samples
for k in <worker-keys>; do
  python3 -c "
import json,glob
d=json.load(open(glob.glob('$R/$k/*.jianji-project.json')[0]))
b=d['exportBatches'][0];t=b['tasks'][0]
print(t['outputArtifact']['path'] if t.get('outputArtifact') else t['outputPath'])
print(b['mediaSnapshots'][0]['sourcePath'])
" | { read out; read src;
  $FF -v error -ss 1.0 -i "$src" -frames:v 1 -vf scale=-2:480 -y $R/visual-samples/$k-src-1s.png
  $FF -v error -ss 1.0 -i "$out" -frames:v 1 -vf scale=-2:480 -y $R/visual-samples/$k-out-1s.png
  $FF -v error -ss 5.3 -i "$out" -frames:v 1 -vf scale=-2:480 -y $R/visual-samples/$k-out-5s.png
  $FF -v error -ss 5.3 -i "$src" -frames:v 1 -vf scale=-2:480 -y $R/visual-samples/$k-src-5s.png
  $FF -v error -i $R/visual-samples/$k-src-1s.png -i $R/visual-samples/$k-out-1s.png -i $R/visual-samples/$k-out-5s.png -i $R/visual-samples/$k-src-5s.png -filter_complex "[0][1][2][3]xstack=inputs=4:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0" -y $R/visual-samples/$k-row.png
}; done
```

每条 row 检查四点:

- `out@1s`:展示文字清晰可读,与本轮用户给定的文字**逐字一致**;四角贴纸在位;有覆盖层时确实遮住原贴纸且不挡主体。
- `out@5.3s`:展示文字已消失;普通贴纸仍在;覆盖贴纸按冻结时段在/不在都正常。
- `out@5.3s` vs `src@5.3s`:同一场景(源视频可能在中途切换画面,1 秒帧和 5.3 秒帧内容不同是正常的,要和同时间的源帧比),画面未被裁剪,主体/字幕/商品关键信息未被新图层遮挡。
- 源视频自带的文字、横幅与原贴纸保留,不属于新增图层问题。

## Step 6: Manifest And Delivery

```python
import json
from pathlib import Path
R=Path('<planRoot>')
plan=json.loads((R/'production-plan.json').read_text(encoding='utf-8'))
manifest=[]
for w in plan['workers']:
    files=sorted(Path(w['output']).glob('*.mp4'))
    manifest.append({'product':w['product'],'output':w['output'],'count':len(files),'files':[f.name for f in files]})
(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
```

交付报告必须包含:每个产品的输出目录与条数;门禁结果(多少 probed、多少 failures);抽帧检查结论;做过的恢复操作(重启、清理的临时文件);run root 路径;以及明确的剩余风险——"视觉检查为静态抽帧,移动贴纸/快速闪现/结尾渐隐未逐条播放确认,建议抽查播放"。**只说"完成"而不附证据是不可接受的。**

## Gotchas

| 症状 | 原因与处理 |
| --- | --- |
| `Cannot find module 'electron'`(launch.cjs 第一行) | 当前 shell 继承了 IDE 的 `ELECTRON_RUN_AS_NODE=1`,electron 二进制退化成纯 Node。启动命令必须加 `env -u ELECTRON_RUN_AS_NODE`(脚本已内置,不要删) |
| 重启 worker 后 CDP 连不上,electron.log 有 `bind() failed: Address already in use` | 旧 electron 还没释放端口就重启了。`ss -tlnp \| grep <port>` 确认空闲后重跑 `run-worker.sh` |
| 某 worker 明显比其他的慢 | 素材时长差异(实测:蝴蝶贴均值 33s,氨糖膏 107s,肥皂 163s)。其他 worker 完成后可按 §Step 3 扩核重启 |
| 门禁报 `file-set mismatch` 且 disk-only 是 `.*.partial.mp4` | 之前中断渲染的孤儿文件;确认对应任务已通过重试完成后删除,再重跑门禁 |
| 贴纸断言 `set(asset_map)==set(sticker_ids)` 失败 | 换机后历史 plan 的贴纸池与本机来源项目不符。改为从本机来源项目实际出现的 cover `stickerId` 收集贴纸池,并确认每个资源文件存在 |
| 用户同时开着交互应用 | 互不干扰:worker 用独立 userData 与端口。不要读写 `~/.config/jianji`,不要重启用户的应用 |

## Adaptation Checklist (New Machine)

1. 仓库 checkout 到与源批次相同的 commit,`npm install`、构建出 `dist-electron/main.cjs`。
2. 确认 FFmpeg/FFprobe 路径,替换脚本里的 `FFMPEG_ENV` 与 verify 脚本的 `FFPROBE`。
3. 替换所有绝对路径:`REPO`、run root 根目录、`sources` 里的历史 worker 目录、`specs` 里的 `parent` 输出父目录。
4. **向用户要到本轮每个产品的展示文字**,填进 `specs[].price`;拿不到就停止,不得沿用本文档里的历史值。
5. 贴纸池:优先用本机任一历史 plan 的 `randomizedStickerUsage`;断言失败时按 §Gotchas 改为从来源项目收集。
6. 端口:每个 worker 一个空闲端口;CPU:`taskset -c` 按本机核数划分,总和不超物理核。
7. 每个产品 phase 取不同值,避免与上一轮选中同一批版本。
8. 跑通后把本轮 run root 保留为下一轮的历史来源。

## If The New Machine Has No History (Path A / Migration)

Path B 的前提是"同一精确源素材已有 completed 批次"。新机器没有历史时二选一:

- **Path A(首次制作)**:打开应用,导入素材,手工填展示文字,选"前 5 秒显示",走完整的创作+覆盖检查流程(runbook §Path A)。这需要配置模型连接,且每版都要过样片检查。产出首批 completed 批次后,之后就能用本文 Path B。
- **整体迁移**:把源机器上该产品的 ①素材目录(保持相对结构)②至少一个 run root(含项目文件、`.app-profile/jobs`、`agent-stickers`、`source-sticker-knowledge`、`uploaded-stickers`)③贴纸与字体资源 完整复制到新机器,并保持项目文件里记录的绝对路径在新机器上同样成立(最简单的做法是使用相同的用户家目录布局)。指纹(sha256)不一致的文件不能被当作同一资源,不得以同名文件冒充。迁移后用只读方式打开项目确认批次仍为 completed,再按本文 Path B 执行。

## References

- 合同与边界:[batch-video-production-runbook.md](batch-video-production-runbook.md)、仓库根 [AGENTS.md](../AGENTS.md)
- 队列/恢复/发布实现:[queue.ts](../src/main/queue.ts)、[artifact.ts](../src/main/artifact.ts)、[compiler.ts](../src/main/compiler.ts)
- 环境配置与启动:[README.md](../README.md)
