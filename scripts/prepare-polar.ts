import{fromUrl}from'geotiff';
import{createHash}from'node:crypto';
const url='https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif';
const tif=await fromUrl(url,{blockSize:65536,cacheSize:400}),image=await tif.getImage(),width=1440,height=81;
const manifest:any={source:'NOAA ETOPO 2022 v1 60 arc-second surface',url,datum:'EGM2008',license:'US Government public domain',sampling:'0.25 degree geographic grid, bilinear source resampling; north of 70 N and south of 70 S',files:[]};
for(const hemisphere of ['north','south']){
 const raster=await image.readRasters({window:hemisphere==='north'?[0,0,21600,1201]:[0,9599,21600,10800],width,height,interleave:true,resampleMethod:'bilinear'});
 const values=Float32Array.from(raster as Float32Array,x=>Math.max(0,Number(x)));
 // All longitudes denote the same mathematical pole. Collapse source edge samples to one value.
 const row=hemisphere==='north'?0:height-1;let avg=0;for(let x=0;x<width;x++)avg+=values[row*width+x]/width;for(let x=0;x<width;x++)values[row*width+x]=avg;
 const path=`public/terrain/polar-${hemisphere}.f32`;await Bun.write(path,values);manifest.files.push({path,bytes:values.byteLength,sha256:createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex'),pole:avg,min:Math.min(...values),max:Math.max(...values)});console.log(hemisphere,manifest.files.at(-1));
}
await Bun.write('public/terrain/polar-manifest.json',JSON.stringify(manifest,null,2));
