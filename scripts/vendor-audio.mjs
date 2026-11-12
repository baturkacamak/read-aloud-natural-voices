// Rebuild locally bundled tempo processing and MP3 encoding; no runtime CDN.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const target=new URL('../src/vendor/audio/',import.meta.url);
await mkdir(target,{recursive:true});
const result=await build({stdin:{contents:"import {SoundTouch,SimpleFilter} from 'soundtouchjs'; globalThis.SesliOkuAudioCodecs={SoundTouch,SimpleFilter};",resolveDir:process.cwd()},bundle:true,format:'iife',minify:true,write:false,legalComments:'inline'});
await writeFile(new URL('codecs.js',target),(await readFile('node_modules/lamejs/lame.min.js','utf8'))+'\n;globalThis.SesliOkuMp3Encoder=lamejs.Mp3Encoder;\n'+result.outputFiles[0].text);
for(const [name,file] of [['lamejs','LICENSE'],['soundtouchjs','LICENSE']])await copyFile(`node_modules/${name}/${file}`,new URL(`${name}-LICENSE`,target));
