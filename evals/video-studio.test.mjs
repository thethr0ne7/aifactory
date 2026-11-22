import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateSpec,buildRenderArgs,render,probe} from '../tools/video-studio.mjs';

function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'factory-video-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function clip(dir,name,color){
  const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c='+color+':s=160x288:r=12','-t','0.7','-c:v','libx264','-pix_fmt','yuv420p',path.join(dir,name)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
}
const base={version:1,format:{width:160,height:288,fps:12},clips:[{path:'red.mp4',duration:.5},{path:'blue.mp4',duration:.5}],output:'result.mp4'};
test('invalid and traversal paths rejected',()=>temp(dir=>{
  fs.writeFileSync(path.join(dir,'red.mp4'),'stub');
  assert.throws(()=>validateSpec({...base,clips:[{path:'../outside.mp4',duration:1}]},dir),/escapes/);
  assert.throws(()=>validateSpec({...base,clips:[{path:'red.mp4',duration:-1}]},dir),/duration/);
  assert.throws(()=>validateSpec({...base,format:{width:161,height:288,fps:12},clips:[{path:'red.mp4',duration:1}]},dir),/even/);
}));
test('out-of-workspace symlink rejected',()=>temp(dir=>{
  const external=path.join(os.tmpdir(),'factory-video-'+process.pid+'.mp4');
  fs.writeFileSync(external,'stub');
  try{
    fs.symlinkSync(external,path.join(dir,'red.mp4'));
    assert.throws(()=>validateSpec({...base,clips:[{path:'red.mp4',duration:1}]},dir),/symlink/);
  }finally{fs.rmSync(external,{force:true});}
}));
test('real FFmpeg render and ffprobe validation',{
  skip:spawnSync('ffmpeg',['-version']).status!==0||spawnSync('ffprobe',['-version']).status!==0
},()=>temp(dir=>{
  clip(dir,'red.mp4','red');
  clip(dir,'blue.mp4','blue');
  const spec=validateSpec(base,dir);
  const args=buildRenderArgs(spec);
  assert.match(args[args.indexOf('-filter_complex')+1],/concat=n=2:v=1:a=0/);
  assert.equal(render(spec,{dryRun:true}).status,'DRY_RUN');
  const r=render(spec);
  assert.equal(r.status,'PASS');
  assert.equal(probe(r.output).width,160);
  assert.ok(fs.statSync(r.output).size>1000);
}));
