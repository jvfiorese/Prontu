/**
 * Prontu — Parser Tia Ju v3
 *
 * COMO FUNCIONA:
 *  1. Cada linha é parseada como "Nome: Valor ..."
 *  2. Se o valor for qualitativo (reagente/não reagente/positivo/etc)
 *     → trata como SOROLOGIA (mantém nome original completo)
 *  3. Se for numérico → busca no dicionário para abbreviar e agrupar
 *  4. Grupos primários (hemo/pcr/hep/prot/renal/eletro/tir/glic/lip/vit/ferro)
 *     recebem seção própria separada por |
 *  5. Sorologias e extras vão no final da linha de labs, em ordem do PDF
 *
 * BUGS CORRIGIDOS em relação à v2:
 *  - Linhas com "VR:" no meio NÃO são mais puladas
 *  - Sorologias mantêm nome original (não são abreviadas)
 *  - Sorologias no bloco usam valor completo; na linha de labs usam valor curto
 *  - Extras e não-reconhecidos mantêm nome original
 *  - Data mantém 4 dígitos do ano
 */
(function () {
  'use strict';

  // ── Normaliza para lookup no dicionário ──────────────────────────
  function norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // remove diacríticos
      .replace(/[^a-z0-9\s]/g, ' ')      // remove pontuação
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Formata data como (dd/mm/aaaa) ──────────────────────────────
  function fmtDate(d, m, y) {
    const yyyy = String(y).length === 2 ? '20' + String(y) : String(y);
    return `(${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${yyyy})`;
  }

  // ── Extrai datas do texto (dd/mm/aaaa ou dd/mm/aa) ───────────────
  function extractDates(text) {
    const re = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/g;
    const seen = new Set(), result = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = +m[1], mo = +m[2];
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) continue;
      const fmt = fmtDate(d, mo, y);
      if (!seen.has(fmt)) {
        seen.add(fmt);
        result.push({ fmt, ts: new Date(y, mo - 1, d).getTime() });
      }
    }
    return result.sort((a, b) => b.ts - a.ts);
  }

  // ════════════════════════════════════════════════════════════════
  // DICIONÁRIO DE EXAMES LABORATORIAIS NUMÉRICOS
  // Cada entrada: { abbr, grupo }
  // SOROLOGIAS não precisam estar aqui — são detectadas pelo VALOR
  // ════════════════════════════════════════════════════════════════
  const DICT = {};
  function def(aliases, abbr, grupo) {
    const e = { abbr, grupo };
    aliases.forEach(a => { DICT[norm(a)] = e; });
  }

  // HEMOGRAMA
  def(['hemoglobina','hgb','hb'],                          'HB',    'hemo');
  def(['hematocrito','htc','ht'],                           'HT',    'hemo');
  def(['eritrocitos','hemacias','rbc'],                     'Hm',    'hemo');
  def(['leucocitos','leucocitos totais','leuco','wbc'],     'Leuco', 'hemo');
  def(['neutrofilos','segmentados','seg'],                  'Seg',   'hemo_dif');
  def(['bastonetes','basto'],                               'Basto', 'hemo_dif');
  def(['linfocitos','linf'],                                'Linf',  'hemo_dif');
  def(['monocitos','mono'],                                 'Mono',  'hemo_dif');
  def(['eosinofilos','eo','eosino'],                        'Eo',    'hemo_dif');
  def(['basofilos','baso'],                                 'Baso',  'hemo_dif');
  def(['plaquetas','pqt','plt'],                            'PQT',   'hemo');
  def(['vpm','volume plaquetario medio'],                   'VPM',   'hemo');
  def(['rdw'],                                              'RDW',   'hemo');
  def(['vcm','volume corpuscular medio'],                   'VCM',   'hemo');
  def(['hcm','hemoglobina corpuscular media'],              'HCM',   'hemo');
  def(['chcm'],                                             'CHCM',  'hemo');
  def(['reticulocitos','retic'],                            'Retic', 'hemo');

  // PCR
  def(['pcr','proteina c reativa','pcr hs','pcr ultrassensivel','proteina c-reativa'], 'PCR', 'pcr');
  def(['procalcitonina','pct'],                             'PCT',   'pcr');

  // HEPATICO
  def(['tgo','ast','aspartato aminotransferase','transaminase oxalacetica'], 'TGO', 'hep');
  def(['tgp','alt','alanina aminotransferase','transaminase piruvica'],      'TGP', 'hep');
  def(['fosfatase alcalina','fa'],                          'FA',    'hep');
  def(['ggt','gamaglutamiltransferase','gama gt','gamma gt','ggtp'], 'GGT', 'hep');
  def(['bilirrubina total','bt','bilirrubinas totais'],     'BT',    'hep');
  def(['bilirrubina direta','bd','bilirrubina conjugada'],  'BD',    'hep');
  def(['bilirrubina indireta','bi','bilirrubina livre'],    'BI',    'hep');
  def(['inr','rni','razao normalizada internacional'],      'INR',   'hep');
  def(['ttpa','aptt','ptt','tromboplastina parcial'],       'TTPA',  'hep');
  def(['tp','tempo de protrombina'],                        'TP',    'hep');
  // Fibrinogênio vai para extras (não é grupo primário)
  def(['fibrinogenio'],                                     'Fibrinogênio', 'extra');

  // PROTEÍNAS
  def(['proteinas totais','ptn totais','prot totais'],      'PT',    'prot');
  def(['albumina','alb'],                                   'ALB',   'prot');
  def(['globulinas','globulina','glob'],                    'GLOB',  'prot');
  def(['relacao ag','relacao a g','razao ag'],              'A/G',   'prot');

  // RENAL
  def(['ureia','ur','nitrogenio ureico','bun'],             'Ur',    'renal');
  def(['creatinina','cr','crea'],                           'Cr',    'renal');
  def(['tfg','taxa de filtracao glomerular','egfr','clearance estimado','tfg ckd'], 'TFG', 'renal');
  def(['depuracao de creatinina','clearance de creatinina'], 'DepCr','renal');
  def(['acido urico','uricemia','urato'],                   'ÁcÚrico','renal');

  // ELETRÓLITOS
  def(['sodio','na'],                                       'Na',    'eletro');
  def(['potassio','k'],                                     'K',     'eletro');
  def(['cloro','cloreto','cl'],                             'Cl',    'eletro');
  def(['calcio total','calcio serico','ca total','ca'],     'Ca',    'eletro');
  def(['fosforo','fosfato','p'],                            'P',     'eletro');
  def(['magnesio','mg'],                                    'Mg',    'eletro');
  def(['bicarbonato','hco3','co2 total'],                   'HCO3',  'eletro');
  def(['lactato','acido lactico'],                          'Lactato','eletro');

  // TIREOIDE
  def(['tsh','hormonio estimulante da tireoide','tsh basal'], 'TSH', 'tir');
  def(['t4 livre','t4l','tiroxina livre','t4 free'],        'T4L',   'tir');
  def(['t3 livre','t3l','triiodotironina livre'],           'T3L',   'tir');

  // GLICEMIA
  def(['glicemia','glicose','gli','glucose','glicemia jejum'], 'GLI','glic');
  def(['hemoglobina glicada','hba1c','glico hemoglobina','hemoglobina glicosilada'], 'HbA1c', 'glic');
  def(['insulina'],                                         'Insulina','glic');

  // LIPÍDIOS
  def(['colesterol total','ct'],                            'CT',    'lip');
  def(['hdl','hdl colesterol','hdl c'],                     'HDL',   'lip');
  def(['ldl','ldl colesterol','ldl c'],                     'LDL',   'lip');
  def(['vldl'],                                             'VLDL',  'lip');
  def(['triglicerides','tgl','tg','triglicerideos'],        'TGL',   'lip');

  // VITAMINAS / ÓSSEO
  def(['vitamina d','vit d','25 oh','25ohd','calcidiol'],   'Vit D', 'vit');
  def(['pth','paratormonio'],                               'PTH',   'vit');

  // FERRO
  def(['ferro serico','ferro'],                             'ferro',       'ferro');
  def(['ferritina'],                                        'ferritina',   'ferro');
  def(['tibc','ctlf','capacidade de ligacao ao ferro',
       'capacidade total de ligacao','capacidade de combinacao do ferro',
       'capacidade total de fixacao do ferro'],             'TIBC',        'ferro');
  def(['saturacao de transferrina','ist','isat'],           'IST',         'ferro');
  def(['vitamina b12','b12','cobalamina'],                  'B12',         'ferro');
  def(['acido folico','folato'],                            'ácido fólico','ferro');
  def(['coombs direto','antiglobulina direta'],             'CoomDs',      'ferro');
  def(['haptoglobina'],                                     'Haptoglobina','ferro');

  // EXTRAS (reconhecidos, mas sem grupo | próprio — vão ao final)
  def(['dhl','ldh','desidrogenase latica'],                 'DHL',    'extra');
  def(['cpk','ck total','creatino quinase'],                'CPK',    'extra');
  def(['vhs','velocidade de hemossedimentacao'],            'VHS',    'extra');
  def(['troponina','trop'],                                 'Troponina','extra');
  def(['bnp','nt probnp'],                                  'BNP',    'extra');
  def(['amilase'],                                          'Amilase','extra');
  def(['lipase'],                                           'Lipase', 'extra');

  // ── Grupos primários (em ordem) ──────────────────────────────────
  const PRIMARY = ['hemo','pcr','hep','prot','renal','eletro','tir','glic','lip','vit','ferro'];

  // Ordem interna de cada grupo
  const ORDER = {
    hemo:  ['HB','HT','Hm','Leuco','PQT','VPM','RDW','VCM','HCM','CHCM','Retic'],
    pcr:   ['PCR','PCT'],
    hep:   ['TGO','TGP','FA','GGT','BT','BD','BI','INR','TTPA','TP'],
    prot:  ['PT','ALB','GLOB','A/G'],
    renal: ['Ur','Cr','TFG','DepCr','ÁcÚrico'],
    eletro:['Na','K','Cl','Ca','P','Mg','HCO3','Lactato'],
    tir:   ['TSH','T4L','T3L'],
    glic:  ['GLI','HbA1c','Insulina'],
    lip:   ['CT','HDL','LDL','VLDL','TGL'],
    vit:   ['Vit D','PTH'],
    ferro: ['ferro','ferritina','TIBC','IST','B12','ácido fólico','CoomDs','Haptoglobina'],
  };

  // ════════════════════════════════════════════════════════════════
  // DETECÇÃO DE RESULTADO QUALITATIVO (sorologia)
  // ════════════════════════════════════════════════════════════════
  const RE_NEG = /\b(n[aã]o\s+reagente|nao\s+reag|n[aã]o\s+detec|n[aã]o\s+reativ|negati|ausente|amostra\s+n[aã]o|nr\b)\b/i;
  const RE_POS = /\b(reagente|positiv|detectado|reativo|presente)\b/i;
  const RE_QUAL = new RegExp(RE_NEG.source + '|' + RE_POS.source + '|\\b(indeterminado|inconclusivo)\\b', 'i');

  function isQual(s)  { return RE_QUAL.test(s); }
  function isPos(s)   { return RE_POS.test(s) && !RE_NEG.test(s); }

  // ── Extrai valor qualitativo (até double-space ou VR:) ────────────
  function getQualVal(afterColon) {
    return afterColon
      .split(/\s{2,}|\s+V\.?R\.?\s*:|\s+Valor\s+de\s+Ref/i)[0]
      .trim();
  }

  // ── Versão curta do valor (sem parênteses) — para linha de labs ──
  function shortVal(v) {
    return v.replace(/\s*\([^)]*\)/g, '').trim();
  }

  // ── Extrai valor numérico (mantém formato BR, preserva %) ─────────
  function getNumVal(afterColon) {
    // Remove cauda de VR / referência
    const clean = afterColon
      .split(/\s{2,}|\s+V\.?R\.?\s*:|\s+Valor\s+de\s+Ref/i)[0]
      .trim();
    // Captura número + opcional %
    const m = clean.match(/^([<>≤≥]?\s*\d[\d.,]*)\s*(%?)/);
    if (!m) return null;
    return m[1].replace(/\s/g, '') + (m[2] || '');
  }

  // ── Lookup no dicionário (match exato, depois por contenção) ──────
  function lookup(nameStr) {
    const t = norm(nameStr);
    if (DICT[t]) return DICT[t];
    let best = null, bestLen = 0;
    for (const [key, val] of Object.entries(DICT)) {
      if (key.length < 3) continue;
      if (t === key) return val;
      // Chave contida no texto do nome OU nome contido na chave
      if (t.includes(key) || key.includes(t)) {
        if (key.length > bestLen) { best = val; bestLen = key.length; }
      }
    }
    return best;
  }

  // ════════════════════════════════════════════════════════════════
  // PARSE DE UMA LINHA
  // ════════════════════════════════════════════════════════════════
  function parseLine(raw) {
    const line = raw.trim();
    if (line.length < 3) return null;

    // Pula linhas que SÃO APENAS referência/cabeçalho (começam com esses padrões)
    if (/^(v\.?r\.?:|valor\s+de\s+ref|referência\s*:|paciente\s*:|prontuário\s*:|data\s+de\s+nasc|médico\s*:|solicitante\s*:|cid\s*:|setor\s*:|hospital\s*:|laboratório\s*:|laudo\s*:)/i.test(line)) return null;

    // Precisa ter dois-pontos numa posição razoável
    const ci = line.indexOf(':');
    if (ci < 2 || ci > 120) return null;

    const name = line.slice(0, ci).trim();
    const rest = line.slice(ci + 1).trim();
    if (!name || !rest) return null;

    return { name, rest };
  }

  // ════════════════════════════════════════════════════════════════
  // PARSER PRINCIPAL
  // ════════════════════════════════════════════════════════════════
  function parse(text) {
    if (!text || !text.trim()) return '';

    const lines = text.split('\n');
    const dates = extractDates(text);
    const dateFmt = dates.length > 0 ? dates[0].fmt : '(data)';

    // Grupos primários: abbr → valor
    const groups = {};
    PRIMARY.forEach(g => { groups[g] = new Map(); });
    const dif = new Map(); // diferencial leucocitário

    // tail: itens que vão no FINAL da linha de labs, na ORDEM do PDF
    // Cada item: string pronta para inserir
    const tail = [];

    // sorologias: para o bloco separado
    const sorologias = []; // { name, fullVal, shortVal, positive }

    // Exames sem resultado numérico detectado
    const semResultado = [];

    // ── Processa cada linha ──────────────────────────────────────
    for (const raw of lines) {
      const p = parseLine(raw);
      if (!p) continue;

      const { name, rest } = p;

      // ── VALOR QUALITATIVO → SOROLOGIA ──────────────────────────
      if (isQual(rest)) {
        const fv = getQualVal(rest);
        const sv = shortVal(fv);
        const positive = isPos(rest);
        sorologias.push({ name, fullVal: fv, shortVal: sv, positive });
        tail.push(`${name}: ${sv}`); // versão curta para linha de labs
        continue;
      }

      // ── VALOR NUMÉRICO ──────────────────────────────────────────
      const nv = getNumVal(rest);
      if (!nv) {
        semResultado.push(name);
        continue;
      }

      const entry = lookup(name);

      if (!entry) {
        // Exame não reconhecido: vai ao final com nome original
        tail.push(`${name} ${nv}`);
        continue;
      }

      if (entry.grupo === 'hemo_dif') {
        dif.set(entry.abbr, nv);
        continue;
      }

      if (PRIMARY.includes(entry.grupo)) {
        if (!groups[entry.grupo].has(entry.abbr)) {
          groups[entry.grupo].set(entry.abbr, nv);
        }
        continue;
      }

      // 'extra': reconhecido mas sem grupo | próprio
      tail.push(`${name} ${nv}`);
    }

    // ── Injeta diferencial no Leuco ──────────────────────────────
    if (dif.size > 0 && groups['hemo'].has('Leuco')) {
      const difStr = [...dif.entries()].map(([a,v]) => `${a} ${v}`).join(', ');
      groups['hemo'].set('Leuco', groups['hemo'].get('Leuco') + ` (${difStr})`);
    }

    // ── Formata cada grupo primário ──────────────────────────────
    function fmtGroup(g) {
      const map = groups[g];
      if (!map || map.size === 0) return '';
      const ord = ORDER[g] || [];
      const parts = [];
      ord.forEach(k => { if (map.has(k)) parts.push(`${k} ${map.get(k)}`); });
      map.forEach((v, k) => { if (!ord.includes(k)) parts.push(`${k} ${v}`); });
      return parts.join(', ');
    }

    // ── Monta linha de labs ──────────────────────────────────────
    const groupParts = PRIMARY.map(g => fmtGroup(g)).filter(Boolean);

    // tail vai APÓS o último grupo (vírgula, não |)
    if (tail.length > 0 && groupParts.length > 0) {
      groupParts[groupParts.length - 1] += ', ' + tail.join(', ');
    } else if (tail.length > 0) {
      groupParts.push(tail.join(', '));
    }

    const labsLine = groupParts.join(' | ');

    // ── Monta bloco de sorologias (positivos | negativos) ────────
    const soroPos = sorologias.filter(s => s.positive).map(s => `${s.name}: ${s.fullVal}`);
    const soroNeg = sorologias.filter(s => !s.positive).map(s => `${s.name}: ${s.fullVal}`);
    let soroBlock = '';
    if (soroPos.length && soroNeg.length) soroBlock = soroPos.join(', ') + ' | ' + soroNeg.join(', ');
    else if (soroPos.length) soroBlock = soroPos.join(', ');
    else if (soroNeg.length) soroBlock = soroNeg.join(', ');

    // ════════════════════════════════════════════════════════════
    // OUTPUT FINAL
    // ════════════════════════════════════════════════════════════
    let out = '';

    out += '# Sorologias / Rastreios\n';
    if (soroBlock) out += `- ${dateFmt}: ${soroBlock}\n`;
    out += '\n';

    out += '# Laboratoriais\n';
    if (labsLine) out += `- ${dateFmt}: ${labsLine}\n`;
    out += '\n';

    out += '# Imagem\n\n';
    out += '# Escopias\n\n';
    out += '# Outros Exames\n\n';
    out += '# Resultados Anatomopatológicos, Histopatológicos e Imunohistoquímicos\n\n';
    out += '# Pareceres\n\n';
    out += '# Pendencias Exames\n';
    if (semResultado.length > 0) out += `- ${dateFmt}: ${semResultado.join(', ')}\n`;

    return out;
  }

  window.parsearExamesTiaJu = parse;

})();
