#!/usr/bin/env node
// Bounded local FFmpeg assembler. Node builtins only; no network or package installation.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const VIDEO=new Set(['.mp4','.mov','.mkv','.webm']);
const IMAGE=new Set(['.png','.jpg','.jpeg','.webp']);
const AUDIO=new Set(['.wav','.mp3','.m4a','.aac','.flac','.ogg']);
function check(ok,msg){if(!ok)throw Error(msg);}
function within(root,item){const rel=path.relative(root,item);return rel===''||(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));}
function num(n,key,min,max,integer=false){check(typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n)),key+' out of range');return n;}
function source(root,p,exts){
  check(typeof p==='string'&&p.length>0&&!path.isAbsolute(p),'Source path must be relative');
  const resolved=path.resolve(root,p);
  check(within(root,resolved),'Source path escapes workspace');
  check(exts.has(path.extname(resolved).toLowerCase()),'Unsupported source extension');
  const real=fs.realpathSync(resolved);
  check(within(root,real),'Source symlink escapes workspace');
  check(fs.statSync(real).isFile(),'Source is not a file');
  return real;
}
function destination(root,p){
  check(typeof p==='string'&&p.length>0&&!path.isAbsolute(p),'Output path must be relative');
  const resolved=path.resolve(root,p);
  check(within(root,resolved)&&resolved!==root,'Output escapes workspace');
  check(path.extname(resolved).toLowerCase()==='.mp4','Only MP4 output supported');
  check(within(root,fs.realpathSync(path.dirname(resolved))),'Output directory symlink escapes workspace');
  check(!fs.existsSync(resolved)||!fs.lstatSync(resolved).isSymbolicLink(),'Output symlink forbidden');
  return resolved;
}
export function validateSpec(input,folder){
  const root=fs.realpathSync(folder);
  check(input&&typeof input==='object'&&!Array.isArray(input)&&input.version===1,'Unsupported spec version');
  const f=input.format||{};
  const width=num(f.width??1080,'width',64,4096,true);
  const height=num(f.height??1920,'height',64,4096,true);
  check(width%2===0&&height%2===0,'Video dimensions must be even');
  const fps=num(f.fps??30,'fps',1,60,true);
  check(Array.isArray(input.clips)&&input.clips.length>0&&input.clips.length<=100,'Expected 1..100 clips');
  const clips=input.clips.map((c,i)=>{
    check(c&&typeof c==='object','Invalid clip '+i);
    const duration=num(c.duration,'duration',0.1,600);
    const filename=source(root,c.path,new Set([...VIDEO,...IMAGE]));
    const image=IMAGE.has(path.extname(filename).toLowerCase());
    const start=num(c.start??0,'start',0,36000);
    check(!image||start===0,'Image cannot have start offset');
    return {path:filename,duration,start,image};
  });
  const duration=clips.reduce((n,c)=>n+c.duration,0);
  check(duration<=600,'Total duration exceeds 600 seconds');
  let audio=null;
  if(input.audio!=null){
    check(typeof input.audio==='object','Audio must be object');
    audio={path:source(root,input.audio.path,AUDIO),volume:num(input.audio.volume??1,'volume',0,2),loop:input.audio.loop===true};
  }
  return {root,clips,format:{width,height,fps},duration,audio,output:destination(root,input.output??'output.mp4')};
}
export function buildRenderArgs(spec){
  const {width,height,fps}=spec.format;
  const args=['-hide_banner','-loglevel','error','-y'];
  for(const c of spec.clips){
    if(c.image)args.push('-loop','1','-framerate',String(fps),'-t',String(c.duration),'-i',c.path);
    else args.push('-ss',String(c.start),'-t',String(c.duration),'-i',c.path);
  }
  if(spec.audio){if(spec.audio.loop)args.push('-stream_loop','-1');args.push('-i',spec.audio.path);}
  const filters=spec.clips.map((c,i)=>'['+i+':v]scale='+width+':'+height+':force_original_aspect_ratio=decrease,pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:black,fps='+fps+',setsar=1,format=yuv420p,trim=duration='+c.duration+',setpts=PTS-STARTPTS[v'+i+']');
  if(spec.clips.length===1)filters.push('[v0]null[vout]');
  else filters.push(spec.clips.map((c,i)=>'[v'+i+']').join('')+'concat=n='+spec.clips.length+':v=1:a=0[vout]');
  if(spec.audio)filters.push('['+spec.clips.length+':a]atrim=duration='+spec.duration+',asetpts=PTS-STARTPTS,volume='+spec.audio.volume+'[aout]');
  args.push('-filter_complex',filters.join(';'),'-map','[vout]');
  if(spec.audio)args.push('-map','[aout]','-c:a','aac','-b:a','160k');else args.push('-an');
  args.push('-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-r',String(fps),'-t',String(spec.duration),'-movflags','+faststart',spec.output);
  return args;
}
function run(exe,args,timeout=180000){
  const r=spawnSync(exe,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024,shell:false});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error(exe+' failed ('+r.status+'): '+String(r.stderr).slice(-2000));
  return r.stdout||'';
}
export function doctor(){
  const d={};
  for(const exe of ['ffmpeg','ffprobe','auto-editor','openfilm','node']){
    try{d[exe]={available:true,version:run(exe,['-version'],10000).split('\n')[0]};}
    catch{d[exe]={available:false};}
  }
  return d;
}
export function probe(filename){
  const j=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name,r_frame_rate','-show_entries','format=duration,format_name','-of','json',filename]));
  check(j.streams?.length>0,'No video stream');
  return {...j.streams[0],duration:Number(j.format?.duration),format:j.format?.format_name};
}
export function render(spec,{dryRun=false}={}){
  const args=buildRenderArgs(spec);
  if(dryRun)return {status:'DRY_RUN',command:['ffmpeg',...args],output:spec.output,duration:spec.duration};
  run('ffmpeg',args);
  const video=probe(spec.output);
  check(video.width===spec.format.width&&video.height===spec.format.height,'Output dimensions mismatch');
  check(Number.isFinite(video.duration)&&Math.abs(video.duration-spec.duration)<=Math.max(.2,2/spec.format.fps),'Output duration mismatch');
  return {status:'PASS',output:spec.output,video};
}
function main(argv){
  const [command,json,flag,folder]=argv;
  if(command==='doctor'){console.log(JSON.stringify(doctor(),null,2));return;}
  check(['plan','render','verify'].includes(command),'Usage: doctor | plan|render|verify film.json [--workspace dir]');
  check(typeof json==='string','Missing JSON spec');
  check(!flag||flag==='--workspace','Expected --workspace');
  const spec=validateSpec(JSON.parse(fs.readFileSync(json,'utf8')),folder??path.dirname(path.resolve(json)));
  const result=command==='verify'?{expectedDuration:spec.duration,video:probe(spec.output)}:render(spec,{dryRun:command==='plan'});
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(e){console.error('VIDEO_STUDIO_ERROR: '+e.message);process.exitCode=1;}
}
