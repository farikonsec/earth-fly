import {expect,test} from 'bun:test';import {Terrain} from '../src/terrain';
test('a bundled LIDAR grid overrides the global elevation inside its bounds and feathers into it at the edges',()=>{
 const t=new Terrain();t.global=new Float32Array(720*361).fill(100);
 const cols=200,rows=100,data=new Int16Array(cols*rows);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)data[y*cols+x]=(20+x*.1)*10;
 t.dem={west:-.5,east:.5,south:51,north:51.5,cols,rows,data,feather:.05};
 // Centre: pure grid value (x index ~99.5 -> 29.95 m).
 expect(Math.abs(t.height(51.25,0)-29.95)).toBeLessThan(.06);
 // Outside: untouched global value; just inside the edge: a blend between the two.
 expect(t.height(51.25,.6)).toBeCloseTo(100,5);const edge=t.height(51.25,.49);expect(edge).toBeGreaterThan(40);expect(edge).toBeLessThan(100);});
