// ---------------------------------------------------------------------------
// Tenis / voleybol ralli motoru — HER SPOR KENDİ KURALLARIYLA (0715 revizyon):
//   TENİS:    sayı→oyun (15/30/40, deuce/avantaj), 6 oyunla set (2 fark;
//             6-6'da sonraki oyun 7-6 yapar). Vuruşlar file üstünden teker
//             teker, alçak yay.
//   VOLEYBOL: her ralli 1 sayı; set 25'e (5. set 15'e), 2 fark, 27/17 tavan.
//             Ralli = servis + karşılamada 3 DOKUNUŞ (manşet→pas→smaç) —
//             tenisten görünür biçimde farklı: yüksek yaylar, hızlı tempo.
//   Set bittiğinde ralliler DURUR (set arası) — sunucu seti çevirince
//   (setIdx değişir) yeni set sıfırdan başlar. Sunucu setleri otoritedir.
// Tek ralli listesi + paylaşılan set saati: top, merdiven, servis oku ve feed
// hep aynı kaynaktan. 320×200 viewBox, ev sağ taraf, file x=160.
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';
export type TPlay = 'ace' | 'winner' | 'error' | 'rally';
export type CourtSport = 'tennis' | 'volleyball';

interface Wp { t: number; x: number; y: number; arc: number }
export interface Rally {
  idx: number; start: number; end: number; holdEnd: number;
  winner: Side; type: TPlay; server: Side;
  wps: Wp[]; die: { x: number; y: number };
  gamesH: number; gamesA: number;   // tenis: oyunlar · voleybol: sayılar
  ph: number; pa: number;           // tenis: oyun içi sayılar
  done: boolean;                    // bu ralliyle set bitti (sonrası set arası)
}

const POINT_MAP = ['0', '15', '30', '40'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

const cache = new Map<string, Rally[]>();

function build(matchId: string, setIdx: number, sport: CourtSport): Rally[] {
  const rng = seeded(`${matchId}:set${setIdx}:${sport}:v2`);
  const vb = sport === 'volleyball';
  // Tempo SUNUCU set penceresine göre: maç toplam 480sn, sayılar orantılı →
  // voleybol seti ~108-160sn, tenis seti ~160-240sn. Sim seti pencereden ERKEN
  // bitirmeli (kalan süre = set arası, top ölü); geç kalırsa merdiven sete
  // yetişemeden sunucu çevirir. Hedef: vb ~95sn, tenis ~155sn.
  const HOLD = vb ? 0.6 : 0.7;
  const GAP = vb ? 0.3 : 0.35;
  const target = vb ? (setIdx >= 4 ? 15 : 25) : 0;      // vb sayı hedefi (5. set 15)
  const capPts = vb ? target + 2 : 0;                    // 27 / 17 tavanı
  const rallies: Rally[] = [];
  const startServer: Side = rng() < 0.5 ? 'home' : 'away';
  let server = startServer;
  let t = 2;
  let ph = 0, pa = 0, gh = 0, ga = 0;                    // tenis fold (vb: gh/ga = sayılar)
  let done = false;

  const yIn = () => (vb ? 44 + rng() * 112 : 50 + rng() * 100);
  const backX = (s: Side) => (s === 'home' ? 244 + rng() * 34 : 42 + rng() * 34);
  const netX = (s: Side) => (s === 'home' ? 176 + rng() * 14 : 130 + rng() * 14);

  for (let i = 0; i < 600 && !done; i++) {
    const r = rng();
    const type: TPlay = r < 0.1 ? 'ace' : r < 0.42 ? 'winner' : r < 0.78 ? 'error' : 'rally';
    const winner: Side = type === 'ace' ? server : rng() < (server === 'home' ? 0.55 : 0.45) ? 'home' : 'away';
    const loser = other(winner);
    const loserRight = loser === 'home';
    const srvThis = server;                               // BU rallinin servisçisi (fold'dan önce)

    // --- yol noktaları (waypoint'ler) ---------------------------------------
    const wps: Wp[] = [];
    let wt = t;
    const push = (x: number, y: number, dur: number, arc: number) => { wt += dur; wps.push({ t: wt, x: clamp(x, 16, 304), y: clamp(y, 28, 172), arc }); };

    if (vb) {
      // servis: yüksek yayla karşı sahaya
      push(loserRight && type === 'ace' ? 200 : server === 'home' ? 96 : 224, yIn(), 0.4, 20);
      const crossings = type === 'ace' ? 0 : type === 'error' ? (rng() < 0.5 ? 0 : 1) : 1 + Math.floor(rng() * 2);
      let sideNow: Side = other(server);
      for (let c = 0; c < crossings; c++) {
        push(backX(sideNow), yIn(), 0.22, 6);            // manşet (geri saha)
        push(netX(sideNow), yIn(), 0.22, 9);             // pas (file önü)
        sideNow = other(sideNow);
        push(sideNow === 'home' ? 200 + rng() * 70 : 50 + rng() * 70, yIn(), 0.3, 16);  // SMAÇ
      }
      if (type === 'error') {
        push(160, 60 + rng() * 80, 0.22, 8);             // fileye takıldı
        push(loserRight ? 174 : 146, yIn(), 0.22, 5);    // geri sekti
      } else if (type !== 'ace') {
        // son smaç kaybedenin sahasında öldü — düzelt: sondaki nokta loser tarafında olsun
        const last = wps[wps.length - 1];
        last.x = clamp(loserRight ? 210 + rng() * 50 : 60 + rng() * 50, 16, 304);
      }
    } else {
      // tenis: vuruşlar dönüşümlü, alçak yay; son vuruşu KAZANAN yapar
      let strokes = type === 'ace' ? 1 : type === 'rally' ? 6 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 4);
      if (type !== 'ace') {
        const hitterOf = (k: number): Side => (k % 2 === 0 ? server : other(server));
        const lastHitter: Side = type === 'error' ? loser : winner;
        if (hitterOf(strokes - 1) !== lastHitter) strokes += strokes > 2 ? -1 : 1;
      }
      for (let k = 0; k < strokes; k++) {
        const recvRight = (k % 2 === 0 ? other(server) : server) === 'home';
        push(recvRight ? 196 + rng() * 84 : 40 + rng() * 84, yIn(), 0.38, 11);
      }
      if (type === 'error') {
        wps[wps.length - 1].x = 160; wps[wps.length - 1].arc = 8;
        push(loserRight ? 173 : 147, yIn(), 0.3, 5);     // fileden geri sekme
      } else if (type === 'ace') {
        wps[0].x = loserRight ? 208 : 112; wps[0].y = rng() < 0.5 ? 62 : 138;
      } else {
        const last = wps[wps.length - 1];
        last.x = clamp(loserRight ? 230 + rng() * 56 : 34 + rng() * 56, 16, 304);
      }
    }
    const die = { x: wps[wps.length - 1].x, y: wps[wps.length - 1].y };

    // --- kural fold'u --------------------------------------------------------
    if (vb) {
      if (winner === 'home') gh++; else ga++;
      const lead = Math.abs(gh - ga);
      if ((gh >= target || ga >= target) && lead >= 2) done = true;
      if (gh >= capPts || ga >= capPts) {
        // voleybolda set 1 farkla BİTEMEZ (27-26 imkânsız skor; sunucu hep 2
        // farkla üretir) — tavana 1 farkla gelindiyse kapanışı çift sayı yap
        if (Math.abs(gh - ga) < 2) { if (winner === 'home') gh++; else ga++; }
        done = true;
      }
      server = winner;                                    // sayıyı alan servis atar
    } else {
      if (winner === 'home') ph++; else pa++;
      if ((ph >= 4 || pa >= 4) && Math.abs(ph - pa) >= 2) {
        if (ph > pa) gh++; else ga++;
        ph = 0; pa = 0;
        if ((gh >= 6 || ga >= 6) && Math.abs(gh - ga) >= 2) done = true;
        if (gh === 7 || ga === 7) done = true;            // 6-6 → sonraki oyun 7-6
        server = (gh + ga) % 2 === 0 ? startServer : other(startServer);
      }
    }

    rallies.push({ idx: i, start: t, end: wt, holdEnd: wt + HOLD, winner, type, server: srvThis, wps, die, gamesH: gh, gamesA: ga, ph, pa, done });
    t = wt + HOLD + GAP;
  }

  // GARANTİ: sunucu seti orantılı akıtır (480sn / maçın toplam sayısı·oyunu),
  // yani pencere = birim × sunucu-temposu. Sim birim başına BÜTÇEYİ (vb 2.0
  // sn/sayı — toplam ≤240 sayıya kadar güvenli; tenis 13 sn/oyun — toplam ≤36
  // oyuna kadar) aşıyorsa tüm zaman çizelgesi orantılı sıkışır → deuce/uzun
  // set dahil merdiven HEP sunucudan önce set skorunu tamamlar, kalan süre
  // doğal "set arası" (top ölü) olur.
  const lastR = rallies[rallies.length - 1];
  if (lastR) {
    const units = lastR.gamesH + lastR.gamesA;   // vb: sayılar · tenis: oyunlar
    // MUTLAK TAVAN (denetim): birim-çarpanı sim'in KENDİ set uzunluğuyla
    // orantılı olduğundan sunucunun kısa penceresini aşabiliyordu (vb 27-25
    // sim × 2.0 > sunucu 45 sayı penceresi; tenis 13×13=169 > ~150sn min
    // pencere). Tavan min pencerenin altında: merdiven HEP sunucudan önce biter.
    const budget = Math.min(units * (vb ? 1.8 : 13), vb ? 100 : 150);
    const natural = lastR.holdEnd + GAP;
    if (natural > budget && budget > 10) {
      const k = budget / natural;
      for (const r of rallies) {
        r.start *= k; r.end *= k; r.holdEnd *= k;
        for (const w of r.wps) w.t *= k;
      }
    }
  }
  // bellek tavanı: uzun oturumda gezinen her maç×set kalıcı birikmesin
  if (cache.size > 40) { const first = cache.keys().next().value; if (first) cache.delete(first); }
  cache.set(`${matchId}:${setIdx}:${sport}:v2`, rallies);
  return rallies;
}

function sim(matchId: string, setIdx: number, sport: CourtSport): Rally[] {
  return cache.get(`${matchId}:${setIdx}:${sport}:v2`) ?? build(matchId, setIdx, sport);
}

// paylaşılan set saati — tüm bileşenler aynı saniyeyi okur
const anchors = new Map<string, number>();
export function setClockSec(matchId: string, setIdx: number): number {
  const k = `${matchId}:${setIdx}`;
  let a = anchors.get(k);
  if (a === undefined) { a = Date.now(); anchors.set(k, a); }
  return (Date.now() - a) / 1000;
}

// Sunucunun period alanındaki set-içi sayı ("Set 2 · 14-9" → 23) — saat
// tohumlamada kullanılır; parse edilemezse 0.
export function periodPoints(period: string | null): number {
  const m = /·\s*(\d+)\s*-\s*(\d+)/.exec(period ?? '');
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

// Sete ORTADAN katılan izleyici için saat tohumu: çapa YOKKEN sunucunun açtığı
// sayı kadar ralliyi geçmiş sayarak saati geri-tarihler — merdiven 0-0'dan
// değil sunucunun bulunduğu yerden akar, set sunucudan önce biter garantisi
// korunur. İdempotent: çapa varsa dokunmaz.
export function seedSetClock(matchId: string, setIdx: number, sport: CourtSport, srvPts: number): void {
  const k = `${matchId}:${setIdx}`;
  if (anchors.has(k) || srvPts <= 0) return;
  const rl = sim(matchId, setIdx, sport);
  const r = rl[Math.min(srvPts, rl.length) - 1];
  if (r) anchors.set(k, Date.now() - r.holdEnd * 1000);
}

// Skor AZALIŞI (sunucu düzeltmesi): eski yüksek setlerin çapası/cache'i
// silinir — sunucu aynı set numarasına yeniden gelirse saat sıfırdan başlar.
export function resetSetsFrom(matchId: string, fromIdx: number): void {
  for (let i = fromIdx; i < fromIdx + 8; i++) {
    anchors.delete(`${matchId}:${i}`);
    cache.delete(`${matchId}:${i}:tennis:v2`);
    cache.delete(`${matchId}:${i}:volleyball:v2`);
  }
}

export interface TennisFlow { x: number; y: number; server: Side; dead: boolean }
const baseX = (s: Side) => (s === 'home' ? 292 : 28);

export function rallyFlowAt(matchId: string, setIdx: number, sport: CourtSport, tSec: number): TennisFlow {
  const rl = sim(matchId, setIdx, sport);
  let lo = 0, hi = rl.length - 1, idx = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rl[mid].start <= tSec) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const p = rl[idx];
  if (tSec < p.start) return { x: baseX(p.server), y: 100, server: p.server, dead: true };
  if (tSec >= p.holdEnd) {
    const nx = rl[idx + 1];
    if (!nx) return { x: p.die.x, y: p.die.y, server: p.server, dead: true };   // SET BİTTİ — set arası
    return { x: baseX(nx.server), y: 100, server: nx.server, dead: true };
  }
  if (tSec >= p.end) return { x: p.die.x, y: p.die.y, server: p.server, dead: true };
  // waypoint interpolasyonu (yay yüksekliği segment tipine göre)
  let prev: Wp = { t: p.start, x: baseX(p.server), y: 100, arc: 0 };
  for (const w of p.wps) {
    if (tSec <= w.t) {
      const f = clamp((tSec - prev.t) / Math.max(w.t - prev.t, 0.01), 0, 1);
      const e = f * f * (3 - 2 * f);
      return {
        x: prev.x + (w.x - prev.x) * e,
        y: clamp(prev.y + (w.y - prev.y) * e - Math.sin(f * Math.PI) * w.arc, 22, 176),
        server: p.server, dead: false,
      };
    }
    prev = w;
  }
  return { x: p.die.x, y: p.die.y, server: p.server, dead: true };
}

export function rallyState(matchId: string, setIdx: number, sport: CourtSport, tSec: number): { games: [number, number]; point: string; server: Side; setOver: boolean } {
  const rl = sim(matchId, setIdx, sport);
  let last: Rally | null = null;
  for (const p of rl) { if (p.end <= tSec) last = p; else break; }
  const srv = last ? (rl[last.idx + 1]?.server ?? last.server) : rl[0]?.server ?? 'home';
  if (!last) return { games: [0, 0], point: sport === 'tennis' ? '0 - 0' : '', server: srv, setOver: false };
  if (sport === 'volleyball') return { games: [last.gamesH, last.gamesA], point: '', server: srv, setOver: last.done };
  const { ph, pa } = last;
  let point: string;
  if (ph >= 3 && pa >= 3) point = ph === pa ? 'Deuce' : ph > pa ? 'Ad ·' : '· Ad';
  else point = `${POINT_MAP[Math.min(3, ph)]} - ${POINT_MAP[Math.min(3, pa)]}`;
  return { games: [last.gamesH, last.gamesA], point, server: srv, setOver: last.done };
}

export interface TEvent { key: string; sec: number; type: TPlay; side: Side }
export function tennisFeed(matchId: string, setIdx: number, sport: CourtSport, uptoSec: number): TEvent[] {
  return sim(matchId, setIdx, sport)
    .filter((p) => p.end <= uptoSec)
    .map((p) => ({ key: `r${setIdx}-${p.idx}`, sec: p.end, type: p.type, side: p.winner }));
}
