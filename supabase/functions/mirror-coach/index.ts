import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// DAVRANIŞ AYNASI — LLM "ses". Deterministik sayıları (frontend'in zaten
// hesaplattığı ayna özeti) alıp KISA, dürüst, yargılamayan bir Türkçe koçluk
// mesajına döker. İLKE: sayılar backend'de deterministik üretilir; LLM yalnız
// cümleye döker, ASLA yeni sayı/iddia uydurmaz. Key yoksa {text:null} — frontend
// deterministik metne düşer. verify_jwt=true → sadece girişli kullanıcı çağırır.
//
// GEREKLİ: Supabase secret ANTHROPIC_API_KEY (Rasim ekler).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Sen PickPlay'in davranış koçusun. PickPlay bir bahis sitesi DEĞİL; sembolik altınla oynanan, PARA OLMAYAN bir davranış aynası. Görevin: kullanıcının kendi oyun verisinden çıkan teşhisi alıp ona KISA bir koçluk mesajı yazmak.

Kurallar:
- Türkçe, 2-4 cümle, sıcak ama dürüst. Yargılama, ahlak dersi verme; ayna tut.
- SADECE sana verilen sayıları/teşhisleri kullan. Yeni sayı, oran, iddia UYDURMA.
- Arketip adını (card.archetype) TEKRAR ETME; o zaten ekranda kullanıcıya gösteriliyor. Doğrudan içgörüye geç, başlık/etiket yazma.
- SAYI DOĞRULUĞU: net > 0 olan oyun KÂRDADIR; net < 0 olan ZARARDADIR. Bunları karıştırma, "başabaş" deme. Kârda olduğu oyunu kârda olarak an.
- Benchmark'ta dilim (percentile) verilmişse doğru yorumla: disiplinde yüksek dilim = çoğundan iyi.
- Klişe ve genel-geçer laf yok ("kontrollü oyna" gibi). Somut ve kişisel ol.
- En güçlü 1-2 desene odaklan; her şeyi sayma. Bir de somut, uygulanabilir tek öneri ver.
- "Para" yerine "altın" veya "bakiye" de; gerçek para yok.
- Düz metin döndür, markdown/başlık yok. Doğrudan kullanıcıya "sen" diye hitap et.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ text: null, reason: "no_key" });

  let summary: unknown;
  try { summary = (await req.json())?.summary; } catch { return json({ text: null, reason: "bad_input" }); }
  if (!summary) return json({ text: null, reason: "empty" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 320,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: "İşte oyuncunun ayna özeti (JSON). Buna göre koçluk mesajını yaz:\n\n" + JSON.stringify(summary),
        }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ text: null, reason: "api_error", detail: t.slice(0, 200) });
    }
    const data = await r.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    return json({ text: text || null });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
