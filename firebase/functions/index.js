/* Maré: avisos no celular (Firebase Cloud Functions) */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "southamerica-east1", maxInstances: 2, memory: "256MiB" });

const db = admin.firestore();
const TZ = "America/Sao_Paulo";

const hoje = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const minutosAgora = (d = new Date()) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = t => +p.find(x => x.type === t).value;
  return g("hour") * 60 + g("minute");
};
const okData = s => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s);
const dias = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);

/* Média dos últimos ciclos registrados (igual ao app) */
function mediaCiclo(st) {
  const s = [...new Set(Array.isArray(st) ? st : [])].filter(okData).sort(), iv = [];
  for (let i = 1; i < s.length; i++) { const d = dias(s[i], s[i - 1]); if (d >= 21 && d <= 45) iv.push(d); }
  const u = iv.slice(-6);
  return u.length >= 2 ? Math.round(u.reduce((a, b) => a + b, 0) / u.length) : 0;
}

/* Mesma conta do app: d = dias desde o início da última menstruação */
function ciclo(S, t) {
  if (!S || !okData(S.last)) return null;
  const media = S.autoc !== false ? mediaCiclo(S.starts) : 0;
  const c = Math.min(45, Math.max(21, media || +S.cyc || 28));
  const d = dias(t, S.last);
  if (d < 0) return null;
  return { c, d, atraso: d - c };
}

async function tokensDe(uid) {
  if (!uid) return [];
  const s = await db.doc("tokens/" + uid).get();
  const l = s.exists ? s.get("lista") : [];
  return Array.isArray(l) ? l.filter(x => typeof x === "string" && x) : [];
}

async function enviar(uid, title, body, tag) {
  const tokens = await tokensDe(uid);
  if (!tokens.length) return 0;
  const r = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title, body, tag: tag || "mare", url: "/" },
    webpush: { headers: { Urgency: "high", TTL: "43200" } }
  });
  const ruins = [];
  r.responses.forEach((x, i) => {
    const c = x.error && x.error.code;
    if (!x.success && (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument")) ruins.push(tokens[i]);
  });
  if (ruins.length) await db.doc("tokens/" + uid).update({ lista: admin.firestore.FieldValue.arrayRemove(...ruins) }).catch(() => {});
  return r.successCount;
}

/* Evita mandar o mesmo aviso duas vezes no mesmo dia */
async function jaEnviado(casal, chave, t) {
  const ref = db.doc("envios/" + casal);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref);
    let dia = s.exists ? s.get("dia") : "";
    let l = s.exists ? s.get("chaves") || [] : [];
    if (dia !== t) { dia = t; l = []; }
    if (l.includes(chave)) return true;
    l.push(chave);
    tx.set(ref, { dia, chaves: l });
    return false;
  });
}

const plural = n => `${n} dia${n > 1 ? "s" : ""}`;
const MSG = {
  tpm: {
    ela: ["Sua TPM começa hoje", "Cuide-se com carinho e registre como você se sente no Maré."],
    ele: ["A TPM dela começa hoje", "Abra o Maré para ver como ajudar hoje."]
  },
  menst: {
    ela: ["Sua menstruação deve começar hoje", "Quando descer, marque no Maré para ajustar as previsões."],
    ele: ["A menstruação dela deve começar hoje", "Paciência extra, um chá e uma bolsa de água quente ajudam."]
  },
  fertilEvitar: {
    ela: ["O período fértil começa hoje", "A chance de gravidez fica maior nos próximos dias. Combine com ele de usar proteção."],
    ele: ["O período fértil dela começa hoje", "A chance de gravidez fica maior nos próximos dias. Usem proteção."]
  },
  fertilTentar: {
    ela: ["O período fértil começa hoje", "Bons dias para tentar. A ovulação prevista é daqui a 5 dias."],
    ele: ["O período fértil dela começa hoje", "Bons dias para tentar. A ovulação prevista é daqui a 5 dias."]
  },
  ovulacao: {
    ela: ["Hoje é o dia previsto da ovulação", "Um dos dias mais férteis do ciclo."],
    ele: ["Hoje é o dia previsto da ovulação dela", "Um dos dias mais férteis do ciclo."]
  },
  atraso: {
    ela: n => [`Menstruação atrasada há ${plural(n)}`, "Se ela já veio, marque no Maré. Se houve relação, considere fazer um teste."],
    ele: n => [`A menstruação dela está atrasada há ${plural(n)}`, "Converse com ela com calma e carinho."]
  }
};

async function casaisComDados(fn) {
  const cs = await db.collection("casais").get();
  for (const doc of cs.docs) {
    const C = doc.data();
    if (!C.ela) continue;
    try {
      const p = await db.doc("ela/" + C.ela).get();
      if (p.exists) await fn(doc.id, C, p.data());
    } catch (e) {
      console.error("casal", doc.id, e);
    }
  }
}

/* Todo dia às 9h: TPM, menstruação prevista e atraso (para os dois) */
exports.lembretesDiarios = onSchedule({ schedule: "0 9 * * *", timeZone: TZ }, async () => {
  const t = hoje();
  await casaisComDados(async (id, C, S) => {
    const x = ciclo(S, t);
    if (!x) return;
    const flowHoje = !!(S.logs && S.logs[t] && Array.isArray(S.logs[t].flow) && S.logs[t].flow.length);
    const ev = [];
    if (x.d === x.c - 5) ev.push(["tpm", MSG.tpm.ela, MSG.tpm.ele]);
    if (x.d === x.c && !flowHoje) ev.push(["menst", MSG.menst.ela, MSG.menst.ele]);
    const modo = S.modo || "acompanhar";
    if (modo === "evitar" && x.d === x.c - 20) ev.push(["fertil", MSG.fertilEvitar.ela, MSG.fertilEvitar.ele]);
    if (modo === "engravidar" && x.d === x.c - 20) ev.push(["fertil", MSG.fertilTentar.ela, MSG.fertilTentar.ele]);
    if (modo === "engravidar" && x.d === x.c - 15) ev.push(["ovulacao", MSG.ovulacao.ela, MSG.ovulacao.ele]);
    if (x.atraso >= 1 && x.atraso <= 29 && x.atraso % 2 === 1 && !flowHoje) ev.push(["atraso" + x.atraso, MSG.atraso.ela(x.atraso), MSG.atraso.ele(x.atraso)]);
    for (const [k, a, b] of ev) {
      if (await jaEnviado(id, k, t)) continue;
      await enviar(C.ela, a[0], a[1], k);
      if (C.ele) await enviar(C.ele, b[0], b[1], k);
    }
  });
});

/* A cada 15 minutos: remédios no horário (para os dois) e, às 21h, lembrete para ela registrar o dia */
exports.lembretesRemedios = onSchedule({ schedule: "*/15 * * * *", timeZone: TZ }, async () => {
  const t = hoje(), agora = minutosAgora();
  await casaisComDados(async (id, C, S) => {
    if (agora >= 21 * 60 && agora < 21 * 60 + 15 && S.lemb21 !== false) {
      const L = S.logs && S.logs[t];
      const registrou = !!(L && Object.values(L).some(v => (Array.isArray(v) && v.length) || (typeof v === "string" && v)));
      if (!registrou && !(await jaEnviado(id, "registro", t)))
        await enviar(C.ela, "Como foi o seu dia?", "Registre o humor e os sintomas no Maré. Leva menos de um minuto.", "registro");
    }
    const pills = Array.isArray(S.pills) ? S.pills : [];
    const tomados = S.taken && Array.isArray(S.taken[t]) ? S.taken[t] : [];
    for (let k = 0; k < pills.length; k++) {
      const pl = pills[k];
      if (!pl || !/^\d\d:\d\d$/.test(pl.t || "")) continue;
      const m = +pl.t.slice(0, 2) * 60 + +pl.t.slice(3);
      if (m > agora || m <= agora - 15 || tomados.includes(k)) continue;
      const nome = String(pl.n || "remédio").slice(0, 40);
      if (await jaEnviado(id, `p${k}@${pl.t}`, t)) continue;
      await enviar(C.ela, `Hora de tomar: ${nome}`, "Depois de tomar, marque no Maré.", "p" + k);
      if (C.ele) await enviar(C.ele, `Lembrete para ela: ${nome}`, "É a hora do remédio dela. Que tal lembrar com carinho?", "p" + k);
    }
  });
});

/* Mudanças no casal: libido alta, pedidos dela, respostas e recados dele */
const txt = x => String((x && x.txt) || "").slice(0, 80);
exports.avisosDoCasal = onDocumentUpdated("casais/{id}", async ev => {
  const a = (ev.data && ev.data.after && ev.data.after.data()) || {};
  const b = (ev.data && ev.data.before && ev.data.before.data()) || {};
  const ra = a.resumo || {}, rb = b.resumo || {}, t = hoje(), id = ev.params.id;
  // libido alta: só para ele, uma vez por dia
  if (a.ele && ra.lib === true && ra.td === t && !(rb.lib === true && rb.td === t) && !(await jaEnviado(id, "libido", t)))
    await enviar(a.ele, "Alerta: libido alta hoje", "Ela marcou libido alta. Abra o Maré para ver as ideias.", "libido");
  // pedido novo dela: para ele
  const pa = a.pedido, pb = b.pedido;
  if (a.ele && pa && pa.id && (!pb || pb.id !== pa.id))
    await enviar(a.ele, `Ela pediu: ${txt(pa)}`, "Abra o Maré para responder.", "pedido");
  const da = a.doEle || {}, db_ = b.doEle || {};
  // resposta dele: para ela
  if (da.visto && da.visto.em && (!db_.visto || db_.visto.em !== da.visto.em))
    await enviar(a.ela, `Ele respondeu: ${txt(da.visto)}`, pa && pa.txt ? `Sobre o seu pedido: ${txt(pa)}` : "Abra o Maré para ver.", "resposta");
  // recado dele: para ela
  if (da.recado && da.recado.em && (!db_.recado || db_.recado.em !== da.recado.em))
    await enviar(a.ela, "Recado dele", txt(da.recado), "recado");
});
