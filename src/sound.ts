/** Deterministic bipolar pressure-wave cue; not a calibrated observer-position sonic boom. */
export function sonicWave(rate: number) {
  const data = new Float32Array(Math.round(rate * 1.15));
  let seed = 811;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    // Short bipolar pressure signature followed by a quiet turbulent tail.
    const duration=.112,attack=.0015;
    const n=t<attack?.65*t/attack:t<duration?.65*(1-2*(t-attack)/(duration-attack)):t<duration+attack?-.65*(1-(t-duration)/attack):0;
    data[i]=n+(seed/4294967296*2-1)*.045*Math.exp(-t*7)*(1-Math.exp(-t*200));
  }
  return data;
}
/** Synthesized aircraft sound. No audio assets or autoplay before a gesture. */
export class FlightSound {
  context: AudioContext | null = null;
  gain: GainNode | null = null;
  engine: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  windGain: GainNode | null = null;
  filter: BiquadFilterNode | null = null;
  enabled = true;
  boomsPlayed = 0;
  terrainCues=0;
  lastTerrainTime=-Infinity;
  lastCue: { duration: number; peak: number; time: number } | null = null;
  async start() {
    if (!this.context) {
      const c = (this.context = new AudioContext());
      const master = (this.gain = c.createGain());
      master.gain.value = 0.28;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -10; compressor.ratio.value = 6;
      master.connect(compressor).connect(c.destination);
      const engine = (this.engine = c.createOscillator());
      engine.type = "sawtooth";
      const eg = (this.engineGain = c.createGain());
      eg.gain.value = 0;
      const low = c.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 350;
      engine.connect(low).connect(eg).connect(master);
      engine.start();
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const f = (this.filter = c.createBiquadFilter());
      f.type = "lowpass";
      const wg = (this.windGain = c.createGain());
      wg.gain.value = 0;
      noise.connect(f).connect(wg).connect(master);
      noise.start();
    }
    await this.context.resume();
  }
  sonicCue() {
    const c = this.context;
    if (!c || !this.gain || !this.enabled || c.state !== 'running') return false;
    const wave = sonicWave(c.sampleRate), buffer = c.createBuffer(1, wave.length, c.sampleRate);
    buffer.copyToChannel(wave, 0);
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), volume = c.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 950; volume.gain.value = .8;
    source.connect(filter).connect(volume).connect(this.gain);
    source.onended = () => { source.disconnect(); filter.disconnect(); volume.disconnect(); };
    source.start(); this.boomsPlayed++;
    this.lastCue = { duration: buffer.duration, peak: wave.reduce((a, b) => Math.max(a, Math.abs(b)), 0), time: c.currentTime };
    return true;
  }
  /** The blast wave arriving: a crack, then long low thunder. `strength` is about 5 close in and 0.1 far away. */
  nukeCue(strength:number){
    const c=this.context;if(!c||!this.gain||!this.enabled||c.state!=='running')return false;
    const seconds=9,buffer=c.createBuffer(1,c.sampleRate*seconds,c.sampleRate),d=buffer.getChannelData(0);let low=0,seed=4177;
    for(let i=0;i<d.length;i++){const t=i/c.sampleRate;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;
      // Brown noise for the rumble, with a sharp bipolar front and slow rolling swells.
      low+=(white-low)*.012;d[i]=(low*9*Math.exp(-t*.42)*(.75+.25*Math.sin(t*5.1)*Math.sin(t*1.7))+white*Math.exp(-t*26)*.9+(t<.06?Math.sin(t*52)*1.2:0))*Math.min(1,t*400);}
    const source=c.createBufferSource(),filter=c.createBiquadFilter(),volume=c.createGain();
    source.buffer=buffer;filter.type='lowpass';filter.frequency.value=180+Math.min(2200,strength*500);volume.gain.value=Math.min(3.2,.5+strength*.8);
    source.connect(filter).connect(volume).connect(this.gain);source.onended=()=>{source.disconnect();filter.disconnect();volume.disconnect();};source.start();return true;
  }
  terrainCue(){
    const c=this.context;
    if(!c||!this.gain||!this.enabled||c.state!=='running'||c.currentTime-this.lastTerrainTime<7)return false;
    const oscillator=c.createOscillator(),volume=c.createGain(),t=c.currentTime;
    oscillator.type='sine';oscillator.frequency.value=590;volume.gain.value=0;
    for(const offset of [0,.24]){volume.gain.setValueAtTime(0,t+offset);volume.gain.linearRampToValueAtTime(.07,t+offset+.03);volume.gain.setValueAtTime(.07,t+offset+.1);volume.gain.linearRampToValueAtTime(0,t+offset+.16);}
    oscillator.connect(volume).connect(this.gain);oscillator.onended=()=>{oscillator.disconnect();volume.disconnect();};oscillator.start(t);oscillator.stop(t+.42);
    this.lastTerrainTime=t;this.terrainCues++;return true;
  }
  weaponCue(kind:'gun'|'missile'|'hit'|'lock'){
    const c=this.context;if(!c||!this.gain||!this.enabled||c.state!=='running')return;
    const o=c.createOscillator(),g=c.createGain(),t=c.currentTime,d=kind==='missile'?.35:kind==='hit'?.2:kind==='lock'?.16:.055;o.type=kind==='lock'?'sine':'triangle';o.frequency.setValueAtTime(kind==='lock'?1100:kind==='gun'?170:kind==='hit'?90:330,t);o.frequency.exponentialRampToValueAtTime(kind==='lock'?1600:35,t+d);g.gain.setValueAtTime(kind==='gun'?.12:.2,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(this.gain);o.start(t);o.stop(t+d);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  update(
    throttle: number,
    speed: number,
    density: number,
    paused: boolean,
    hover: boolean,
  ) {
    const c = this.context;
    if (!c || !this.gain) return;
    const t = c.currentTime;
    this.gain.gain.setTargetAtTime(this.enabled && !paused ? 0.25 : 0, t, 0.12);
    this.engine!.frequency.setTargetAtTime(
      33 + throttle * 95 + (hover ? 30 : 0),
      t,
      0.3,
    );
    this.engineGain!.gain.setTargetAtTime(
      throttle * 0.16 + (hover ? 0.08 : 0),
      t,
      0.2,
    );
    this.windGain!.gain.setTargetAtTime(
      Math.min(0.3, (speed / 180) ** 2 * density * 0.13),
      t,
      0.2,
    );
    this.filter!.frequency.setTargetAtTime(
      150 + Math.min(2400, speed * 6),
      t,
      0.3,
    );
  }
}
