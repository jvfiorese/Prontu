/**
 * Prontu — Parser Tia Ju v4
 *
 * Novidades v4:
 *  - Pré-processa hemograma tabular HBDF (linhas sem dois-pontos)
 *  - Captura "Valor de Referência" do próprio texto → marca *** se alterado
 *  - Sub-resultados com "- Param: valor" (Ferro/TIBC, Colesterol, etc.)
 *  - Mais entradas no dicionário (GGT completo, Fosfatase, Fibrinogênio no hep, etc.)
 *  - Cálculo automático de IST quando não fornecido
 */
(function () {
  'use strict';

  // ── Normaliza para lookup ────────────────────────────────────────
  function norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Formata data ─────────────────────────────────────────────────
  function fmtDate(d, m, y) {
    const yyyy = String(y).length === 2 ? '20' + String(y) : String(y);
    return `(${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${yyyy})`;
  }

  // ── Extrai datas do texto ────────────────────────────────────────
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
  // DICIONÁRIO DE EXAMES NUMÉRICOS
  // ════════════════════════════════════════════════════════════════
  const DICT = {};
  function def(aliases, abbr, grupo) {
    const e = { abbr, grupo };
    aliases.forEach(a => { DICT[norm(a)] = e; });
  }

  // HEMOGRAMA
  def(['hemoglobina','hgb','hb'],                               'HB',    'hemo');
  def(['hematocrito','htc','ht'],                               'HT',    'hemo');
  def(['eritrocitos','hemacias','rbc'],                         'Hm',    'hemo');
  def(['leucocitos','leucocitos totais','leuco','wbc'],         'Leuco', 'hemo');
  def(['neutrofilos','segmentados','seg'],                      'Seg',      'hemo_dif');
  def(['bastonetes','basao','basto'],                           'Basto',    'hemo_dif');
  def(['linfocitos','linf'],                                    'Linf',     'hemo_dif');
  def(['monocitos','mono'],                                     'Mono',     'hemo_dif');
  def(['eosinofilos','eo','eosino'],                            'Eo',       'hemo_dif');
  def(['basofilos','baso'],                                     'Baso',     'hemo_dif');
  def(['mielocitos','mielo'],                                   'Mielo',    'hemo_dif');
  def(['metamielocitos','metamielo'],                           'Metamielo','hemo_dif');
  def(['linfocitos reativos','linf reativos','linfocitos atipicos','linf atipicos'], 'LinfR', 'hemo_dif');
  def(['blastos'],                                              'Blastos',  'hemo_dif');
  def(['plaquetas','pqt','plt'],                                'PQT',   'hemo');
  def(['vpm','volume plaquetario medio'],                       'VPM',   'hemo');
  def(['rdw'],                                                  'RDW',   'hemo');
  def(['vcm','volume corpuscular medio'],                       'VCM',   'hemo');
  def(['hcm','hemoglobina corpuscular media'],                  'HCM',   'hemo');
  def(['chcm','concentracao corpuscular media de hemoglobina'], 'CHCM',  'hemo');
  def(['reticulocitos','retic'],                                'Retic', 'hemo');

  // PCR
  def(['pcr','proteina c reativa','pcr hs','pcr ultrassensivel','proteina c-reativa'], 'PCR', 'pcr');
  def(['procalcitonina','pct'],                                 'PCT',   'pcr');

  // HEPÁTICO
  def(['tgo','ast','aspartato aminotransferase','transaminase oxalacetica'], 'TGO', 'hep');
  def(['tgp','alt','alanina aminotransferase','transaminase piruvica'],      'TGP', 'hep');
  def(['fosfatase alcalina','fa'],                              'FA',    'hep');
  def(['ggt','gamaglutamiltransferase','gama gt','gamma gt','ggtp',
       'gama glutamil transferase','ggt gama glutamil transferase'],         'GGT',   'hep');
  def(['bilirrubina total','bt','bilirrubinas totais'],         'BT',    'hep');
  def(['bilirrubina direta','bd','bilirrubina conjugada'],      'BD',    'hep');
  def(['bilirrubina indireta','bi','bilirrubina livre'],        'BI',    'hep');
  def(['inr','rni','razao normalizada internacional'],          'INR',   'hep');
  def(['ttpa','aptt','ptt','tromboplastina parcial'],           'TTPA',  'hep');
  def(['tp','tempo de protrombina','tap','atividade de protrombina'], 'TP', 'hep');
  def(['fibrinogenio'],                                         'Fibrinogênio', 'hep');

  // PROTEÍNAS
  def(['proteinas totais','ptn totais','prot totais'],          'PT',    'prot');
  def(['albumina','alb'],                                       'ALB',   'prot');
  def(['globulinas','globulina','glob'],                        'GLOB',  'prot');
  def(['relacao ag','relacao a g','razao ag'],                  'A/G',   'prot');

  // RENAL
  def(['ureia','ur','nitrogenio ureico','bun'],                 'Ur',    'renal');
  def(['creatinina','cr','crea','creatinina serica'],           'Cr',    'renal');
  def(['tfg','taxa de filtracao glomerular','egfr',
       'clearance estimado','tfg ckd'],                         'TFG',   'renal');
  def(['depuracao de creatinina','clearance de creatinina'],    'DepCr', 'renal');
  def(['acido urico','uricemia','urato'],                       'ÁcÚrico','renal');

  // ELETRÓLITOS
  def(['sodio','na'],                                           'Na',    'eletro');
  def(['potassio','k'],                                         'K',     'eletro');
  def(['cloro','cloreto','cl'],                                 'Cl',    'eletro');
  def(['calcio total','calcio serico','calcio','ca total','ca'], 'Ca',   'eletro');
  def(['fosforo','fosfato','p','fosforo serico'],               'P',     'eletro');
  def(['magnesio','mg'],                                        'Mg',    'eletro');
  def(['bicarbonato','hco3','co2 total'],                       'HCO3',  'eletro');
  def(['lactato','acido lactico','lac'],                        'Lactato','eletro');

  // TIREOIDE
  def(['tsh','hormonio estimulante da tireoide','tsh basal'],   'TSH',   'tir');
  def(['t4 livre','t4l','tiroxina livre','t4 free',
       't4 livre tiroxina livre'],                              'T4L',   'tir');
  def(['t3 livre','t3l','triiodotironina livre'],               'T3L',   'tir');

  // GLICEMIA
  def(['glicemia','glicose','gli','glucose','glicemia jejum'],  'GLI',   'glic');
  def(['hemoglobina glicada','hba1c','glico hemoglobina',
       'hemoglobina glicosilada'],                              'HbA1c', 'glic');
  def(['insulina'],                                             'Insulina','glic');

  // LIPÍDIOS
  def(['colesterol total','ct'],                                'CT',    'lip');
  def(['hdl','hdl colesterol','hdl c','colesterol hdl'],        'HDL',   'lip');
  def(['ldl','ldl colesterol','ldl c','colesterol ldl'],        'LDL',   'lip');
  def(['vldl','colesterol vldl'],                               'VLDL',  'lip');
  def(['triglicerides','tgl','tg','triglicerideos'],            'TGL',   'lip');
  def(['colesterol nao hdl','nao hdl'],                         'nHDL',  'lip');

  // VITAMINAS / ÓSSEO
  def(['vitamina d','vit d','25 oh','25ohd','calcidiol',
       'vitamina d 25oh'],                                      'Vit D', 'vit');
  def(['pth','paratormonio'],                                   'PTH',   'vit');

  // FERRO
  def(['ferro serico','ferro','fe'],                            'ferro',       'ferro');
  def(['ferritina'],                                            'ferritina',   'ferro');
  def(['tibc','ctlf',
       'capacidade de ligacao ao ferro',
       'capacidade total de ligacao do ferro',
       'capacidade total de fixacao do ferro',
       'capacidade de fixacao de ferro',
       'capacidade total'],                                     'TIBC',        'ferro');
  def(['saturacao de transferrina','ist','isat',
       'indice de saturacao de transferrina',
       'indice de saturacao'],                                  'IST',         'ferro');
  def(['capacidade livre de combinacao do ferro',
       'capacidade livre de combinacao',
       'uibc'],                                                 'UIBC',        'ferro');
  def(['vitamina b12','b12','cobalamina'],                      'B12',         'ferro');
  def(['acido folico','folato'],                                'ácido fólico','ferro');
  def(['coombs direto','antiglobulina direta'],                 'CoomDs',      'ferro');
  def(['haptoglobina'],                                         'Haptoglobina','ferro');

  // EXTRAS
  def(['dhl','ldh','desidrogenase latica'],                     'DHL',      'extra');
  def(['cpk','ck total','creatino quinase'],                    'CPK',      'extra');
  def(['vhs','velocidade de hemossedimentacao'],                'VHS',      'extra');
  def(['troponina','trop'],                                     'Troponina','extra');
  def(['bnp','nt probnp'],                                      'BNP',      'extra');
  def(['amilase'],                                              'Amilase',  'extra');
  def(['lipase'],                                               'Lipase',   'extra');
  def(['vancomicina'],                                          'Vancomicina','extra');
  def(['alfa fetoproteina','afp'],                              'AFP',      'extra');
  def(['ca 125','ca125'],                                       'CA-125',   'extra');
  def(['cea','antigeno carcinoembrionario'],                    'CEA',      'extra');
  def(['ca 19','ca19','ca 19 9','ca199'],                       'CA-19',    'extra');
  def(['psa','antigeno prostatico especifico'],                 'PSA',      'extra');

  // ── Grupos primários e ordem interna ────────────────────────────
  const PRIMARY = ['hemo','pcr','hep','prot','renal','eletro','tir','glic','lip','vit','ferro'];

  const ORDER = {
    hemo:  ['HB','HT','Hm','Leuco','PQT','VPM','RDW','VCM','HCM','CHCM','Retic'],
    pcr:   ['PCR','PCT'],
    hep:   ['TGO','TGP','FA','GGT','BT','BD','BI','INR','TTPA','TP','Fibrinogênio'],
    prot:  ['PT','ALB','GLOB','A/G'],
    renal: ['Ur','Cr','TFG','DepCr','ÁcÚrico'],
    eletro:['Na','K','Cl','Ca','P','Mg','HCO3','Lactato'],
    tir:   ['TSH','T4L','T3L'],
    glic:  ['GLI','HbA1c','Insulina'],
    lip:   ['CT','HDL','LDL','VLDL','TGL','nHDL'],
    vit:   ['Vit D','PTH'],
    ferro: ['ferro','ferritina','TIBC','UIBC','IST','B12','ácido fólico','CoomDs','Haptoglobina'],
  };

  // ════════════════════════════════════════════════════════════════
  // LIMPEZA DE NOMES DE SOROLOGIAS
  // Remove prefixos redundantes: "Hepatite B/C" quando o exame já diz tudo
  // ════════════════════════════════════════════════════════════════
  function cleanSoroName(name) {
    let n = name.trim();

    // "Teste Rápido para Hepatite C" → "Teste Rápido HCV"
    n = n.replace(/^(teste\s+r[aá]pido)\s+(?:para\s+)?hepatite\s+c\b.*/i, '$1 HCV');
    // "Teste Rápido para Hepatite B" → "Teste Rápido HBsAg"
    n = n.replace(/^(teste\s+r[aá]pido)\s+(?:para\s+)?hepatite\s+b\b.*/i, '$1 HBsAg');
    // "Teste Rápido HIV" / "Teste Rápido para HIV" → "Teste Rápido HIV"
    n = n.replace(/^(teste\s+r[aá]pido)\s+(?:para\s+)?hiv\b.*/i, '$1 HIV');

    // Remove prefixo "Hepatite X " quando seguido de nome do marcador
    // Ex: "Hepatite B Anti-HBc Total" → "Anti-HBc Total"
    // Ex: "Hepatite C Anti-HCV" → "Anti-HCV"
    // Ex: "Hepatite B HBsAg" → "HBsAg"
    n = n.replace(/^hepatite\s+[abcde]\s+/i, '');

    // "HIV 1 e 2 Pesquisa de Anticorpos..." → "HIV 1 e 2"
    n = n.replace(/\s+pesquisa\s+de\s+anticorpos?\b.*/i, '');

    // Capitalização mínima: garante que Anti- fique com A maiúsculo
    n = n.replace(/^anti\b/i, 'Anti');

    return n;
  }

  // ── Detecção de resultado qualitativo ───────────────────────────
  const RE_NEG = /\b(n[aã]o\s+reagente|nao\s+reag|n[aã]o\s+detec|n[aã]o\s+reativ|negati|ausente|amostra\s+n[aã]o|nr\b)\b/i;
  const RE_POS = /\b(reagente|positiv|detectado|reativo|presente)\b/i;
  const RE_QUAL = new RegExp(RE_NEG.source + '|' + RE_POS.source + '|\\b(indeterminado|inconclusivo)\\b', 'i');

  function isQual(s)  { return RE_QUAL.test(s); }
  function isPos(s)   { return RE_POS.test(s) && !RE_NEG.test(s); }

  function getQualVal(afterColon) {
    return afterColon.split(/\s{2,}|\s+V\.?R\.?\s*:|\s+Valor\s+de\s+Ref/i)[0].trim();
  }

  function shortVal(v) {
    return v.replace(/\s*\([^)]*\)/g, '').trim();
  }

  // ── Formata display de resultado qualitativo ────────────────────
  // Não reagente → "NR" | Reagente → "REAGENTE" (+ índice se houver)
  function fmtSoroDisplay(fv, positive, indice) {
    if (positive) {
      return indice ? `REAGENTE (Índice: ${indice})` : 'REAGENTE';
    }
    if (RE_NEG.test(fv)) return 'NR';
    // Indeterminado / inconclusivo — mantém texto curto
    return shortVal(fv);
  }

  function getNumVal(afterColon) {
    const clean = afterColon.split(/\s{2,}|\s+V\.?R\.?\s*:|\s+Valor\s+de\s+Ref/i)[0].trim();
    const m = clean.match(/^([<>≤≥]?\s*\d[\d.,]*)\s*(%?)/);
    if (!m) return null;
    return m[1].replace(/\s/g, '') + (m[2] || '');
  }

  // ════════════════════════════════════════════════════════════════
  // EXTRAÇÃO DE VALOR DE REFERÊNCIA DO TEXTO
  // ════════════════════════════════════════════════════════════════
  function extractRefRange(line) {
    if (!line) return null;

    // Preferência para adultos quando há múltiplas faixas na mesma linha
    const adultMatch = /adulto[s]?\s*[:\-]?\s*(?:at[eé]\s+)?([\d,\.]+)\s*(?:a|[-–])\s*([\d,\.]+)/i.exec(line);
    if (adultMatch) {
      return {
        min: parseFloat(adultMatch[1].replace(',','.')),
        max: parseFloat(adultMatch[2].replace(',','.')),
      };
    }

    // (MIN - MAX) ou [MIN - MAX] ou MIN - MAX com unidade
    const mRange = /[\(\[]?\s*(\d[\d,\.]*)\s*[-–]\s*(\d[\d,\.]*)\s*[\)\]]?/.exec(line);
    if (mRange) {
      return {
        min: parseFloat(mRange[1].replace(',','.')),
        max: parseFloat(mRange[2].replace(',','.')),
      };
    }

    // MIN a MAX
    const mAa = /(\d[\d,\.]*)\s+a\s+(\d[\d,\.]*)/.exec(line);
    if (mAa) {
      return {
        min: parseFloat(mAa[1].replace(',','.')),
        max: parseFloat(mAa[2].replace(',','.')),
      };
    }

    // Inferior a MAX / Até MAX
    const mMax = /(?:inferior\s+a|at[eé])\s*([\d,\.]+)/i.exec(line);
    if (mMax) return { min: null, max: parseFloat(mMax[1].replace(',','.')) };

    // Superior a MIN
    const mMin = /superior\s+a\s*([\d,\.]+)/i.exec(line);
    if (mMin) return { min: parseFloat(mMin[1].replace(',','.')), max: null };

    return null;
  }

  // ── Verifica se valor está fora de referência ────────────────────
  function isAlterado(valStr, range) {
    if (!range || !valStr) return false;
    const cleaned = String(valStr).replace(/[%\*<>]/g, '').replace(',','.').trim();
    const val = parseFloat(cleaned);
    if (isNaN(val)) return false;
    if (range.min !== null && val < range.min) return true;
    if (range.max !== null && val > range.max) return true;
    return false;
  }

  // ── Lookup no dicionário ─────────────────────────────────────────
  function lookup(nameStr) {
    const t = norm(nameStr);
    if (DICT[t]) return DICT[t];
    let best = null, bestLen = 0;
    for (const [key, val] of Object.entries(DICT)) {
      if (key.length < 3) continue;
      if (t.includes(key) || key.includes(t)) {
        if (key.length > bestLen) { best = val; bestLen = key.length; }
      }
    }
    return best;
  }

  // ════════════════════════════════════════════════════════════════
  // PRÉ-PROCESSAMENTO DO HEMOGRAMA TABULAR (formato HBDF sem dois-pontos)
  // Ordem importa: nomes mais longos primeiro para evitar match parcial
  // ════════════════════════════════════════════════════════════════
  const HEMO_PATTERNS = [
    [/HEMOGLOBINA\s+CORPUSCULAR\s+M[EÉ]DIA/i,                   'HCM'],
    [/CONCENTRA[CÇ][AÃ]O\s+CORPUSCULAR\s+M[EÉ]DIA\s+DE\s+HB/i, 'CHCM'],
    [/CONCENTRA[CÇ][AÃ]O\s+CORPUSCULAR/i,                        'CHCM'],
    [/VOLUME\s+CORPUSCULAR\s+M[EÉ]DIO/i,                         'VCM'],
    [/VOLUME\s+PLAQUETI?[AÁ]RIO\s+M[EÉ]DIO/i,                   'VPM'],
    [/LEUCOCITOS\s+TOTAIS/i,                                      'Leucócitos'],
    [/LEUCOC[IÍ]CITOS/i,                                          'Leucócitos'],
    [/HEMAT[OÓ]CRITO/i,                                           'Hematócrito'],
    [/HEMOGLOBINA/i,                                              'Hemoglobina'],
    [/ERITR[OÓ]CITOS/i,                                           'Eritrócitos'],
    [/HEM[AÁ]CIAS/i,                                              'Hemácias'],
    [/PLAQUETAS/i,                                                'Plaquetas'],
    [/METAMIEL[OÓ]CITOS/i,                                         'Metamielócitos'],
    [/MIEL[OÓ]CITOS/i,                                            'Mielócitos'],
    [/SEGMENTADOS/i,                                              'Segmentados'],
    [/NEUTR[OÓ]FILOS/i,                                           'Neutrófilos'],
    [/BASTONETES/i,                                               'Bastonetes'],
    [/LINF[OÓ]CITOS\s+REATIVOS/i,                                 'Linfócitos Reativos'],
    [/LINF[OÓ]CITOS\s+AT[IÍ]PICOS/i,                              'Linfócitos Atípicos'],
    [/LINF[OÓ]CITOS/i,                                            'Linfócitos'],
    [/MON[OÓ]CITOS/i,                                             'Monócitos'],
    [/EOSINO?F[IÍ]LOS/i,                                          'Eosinófilos'],
    [/BAS[OÓ]FILOS/i,                                             'Basófilos'],
    [/RETICUL[OÓ]CITOS/i,                                         'Reticulócitos'],
    [/BLASTOS/i,                                                  'Blastos'],
    [/\bCHCM\b/i,                                                 'CHCM'],
    [/\bVCM\b/i,                                                  'VCM'],
    [/\bHCM\b/i,                                                  'HCM'],
    [/\bRDW\b/i,                                                  'RDW'],
    [/\bVPM\b/i,                                                  'VPM'],
  ];

  // Tenta extrair pares "Nome Valor" de uma linha tabular (sem dois-pontos)
  function tryExtractTabular(line) {
    if (!line || line.includes(':')) return null;

    const results = [];
    let remaining = line.trim();

    while (remaining.length > 0) {
      let matched = false;

      for (const [pattern, displayName] of HEMO_PATTERNS) {
        // Tenta match no início do restante
        const startRe = new RegExp('^' + pattern.source, 'i');
        const nameMatch = startRe.exec(remaining);
        if (!nameMatch) continue;

        // Após o nome, captura número (com vírgula e %)
        const afterName = remaining.slice(nameMatch[0].length);
        const valMatch = /^\s+([\d,\.]+\s*%?)/.exec(afterName);
        if (!valMatch) continue;

        results.push(`${displayName}: ${valMatch[1].trim()}`);
        remaining = afterName.slice(valMatch[0].length).trim();
        matched = true;
        break;
      }

      if (!matched) break;
    }

    return results.length > 0 ? results : null;
  }

  // Pré-processa todas as linhas
  function preprocessText(text) {
    const lines = text.split('\n');
    const out = [];
    for (const line of lines) {
      const tabResult = tryExtractTabular(line);
      if (tabResult) {
        out.push(...tabResult);
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  // ════════════════════════════════════════════════════════════════
  // PARSE DE UMA LINHA
  // ════════════════════════════════════════════════════════════════
  // Linhas que devem ser puladas
  const SKIP_RE = /^(valor(es)?\s+de\s+refer[eê]ncia|v\.?r\.?:|paciente\s*:|prontu[aá]rio\s*:|data\s+de\s+nasc|m[eé]dico\s*:|solicitante\s*:|cid\s*:|setor\s*:|hospital\s*:|laborat[oó]rio\s*:|laudo\s*:|material\s*:|m[eé]todo\s*:|unidade\s+de|data\s+coleta|data\s+de\s+coleta|liberado\s+por|respons[aá]vel\s+t[eé]cnico|n[uú]cleo\s+de\s+laborat[oó]rio|atendimento\s*:|pedido\s*:|identidade\s*:|sexo\s*:|nascimento\s*:)/i;

  function parseLine(raw) {
    const line = raw.trim();
    if (line.length < 3) return null;

    const lineNorm = norm(line);
    if (SKIP_RE.test(lineNorm)) return null;

    // Remove "- " do início (sub-resultados do tipo "- Ferro: 27 ug/dL")
    const cleanLine = line.replace(/^\s*-\s+/, '');

    const ci = cleanLine.indexOf(':');
    if (ci < 2 || ci > 120) return null;

    const name = cleanLine.slice(0, ci).trim();
    const rest = cleanLine.slice(ci + 1).trim();
    if (!name) return null;

    return { name, rest };
  }

  // ════════════════════════════════════════════════════════════════
  // PARSER PRINCIPAL
  // ════════════════════════════════════════════════════════════════
  function parse(text) {
    if (!text || !text.trim()) return '';

    // 1. Pré-processar hemograma tabular HBDF
    const preprocessed = preprocessText(text);
    const lines = preprocessed.split('\n');

    const dates = extractDates(text);
    const dateFmt = dates.length > 0 ? dates[0].fmt : '(data)';

    const groups = {};
    PRIMARY.forEach(g => { groups[g] = new Map(); });
    const dif = new Map();
    const tail = [];
    const sorologias = [];
    const semResultado = [];

    // Referências extraídas dinamicamente do texto
    const dynRefs = {}; // abbr → { min, max }

    // Último exame numérico parseado (para associar referência)
    let lastAbbr = null;

    // ── Loop principal com lookahead ──────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // ── Linha de referência → captura range para lastAbbr ────────
      if (/^\s*valor(es)?\s+de\s+refer[eê]ncia/i.test(raw)) {
        if (lastAbbr) {
          // Tenta extrair da própria linha
          let range = extractRefRange(raw.replace(/^.*?refer[eê]ncia[^:]*:/i, ''));
          // Se não achou, tenta nas próximas linhas (até 6)
          if (!range) {
            for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
              const nextLine = lines[j].trim();
              if (!nextLine) continue;
              // Para se achar nova seção ou novo exame
              if (/^(paciente|material|m[eé]todo|data\s+de\s+coleta|liberado\s+por)/i.test(nextLine)) break;
              // Prioriza linha com "Adulto(s)"
              if (/adulto/i.test(nextLine)) {
                range = extractRefRange(nextLine);
                if (range) break;
              }
              // Qualquer range válido
              if (!range) range = extractRefRange(nextLine);
            }
          }
          if (range && !dynRefs[lastAbbr]) {
            dynRefs[lastAbbr] = range;
          }
        }
        continue;
      }

      const p = parseLine(raw);
      if (!p) continue;

      const { name, rest } = p;

      // ── QUALITATIVO → SOROLOGIA ────────────────────────────────
      if (isQual(rest)) {
        const fv = getQualVal(rest);
        const sv = shortVal(fv);
        const positive = isPos(rest);

        // Captura Índice na linha seguinte se existir
        let indice = null;
        if (i + 1 < lines.length) {
          const nxt = lines[i + 1].trim();
          const mIdx = /^[ÍI]ndice\s*[:\.].*?([\d,\.]+)\s*$|^[ÍI]ndice\s*:\s*([\d,\.]+)/i.exec(nxt);
          if (mIdx) {
            indice = mIdx[1] || mIdx[2];
            i++; // pula linha do índice
          }
        }

        const displaySoro = fmtSoroDisplay(fv, positive, indice);
        const cleanName = cleanSoroName(name);
        sorologias.push({ name: cleanName, fullVal: displaySoro, shortVal: displaySoro, positive });
        tail.push(`${cleanName}: ${displaySoro}`);
        lastAbbr = null;
        continue;
      }

      // ── NUMÉRICO ───────────────────────────────────────────────
      const nv = getNumVal(rest);
      if (!nv) {
        // Linha sem valor numérico e não qualitativo (ex: sub-resultado vazio)
        // Não adiciona a semResultado se for um sub-cabeçalho
        const entry = lookup(name);
        if (!entry && rest.length < 3) semResultado.push(name);
        continue;
      }

      const entry = lookup(name);

      if (!entry) {
        tail.push(`${name} ${nv}`);
        lastAbbr = null;
        continue;
      }

      // Diferencial leucocitário: sempre em %, nunca marca *** (são proporções, não valores absolutos)
      // lastAbbr fica null para não capturar referência absoluta indevidamente
      if (entry.grupo === 'hemo_dif') {
        const pctVal = nv.endsWith('%') ? nv : nv + '%';
        if (!dif.has(entry.abbr)) dif.set(entry.abbr, pctVal);
        lastAbbr = null;
        continue;
      }

      lastAbbr = entry.abbr;

      // Referência dinâmica → marca *** se alterado (apenas exames não-diferencial)
      const ref = dynRefs[entry.abbr];
      const alt = isAlterado(nv, ref);
      const displayVal = alt ? `${nv}***` : nv;

      if (PRIMARY.includes(entry.grupo)) {
        if (!groups[entry.grupo].has(entry.abbr)) {
          groups[entry.grupo].set(entry.abbr, displayVal);
        }
        continue;
      }

      // extra
      tail.push(`${entry.abbr} ${displayVal}`);
    }

    // ── IST automático (se Fe e TIBC disponíveis mas IST não veio) ──
    const ferroMap = groups['ferro'];
    if (ferroMap.has('ferro') && ferroMap.has('TIBC') && !ferroMap.has('IST')) {
      const feVal  = parseFloat(String(ferroMap.get('ferro')).replace(/[^0-9,.]/g,'').replace(',','.'));
      const tibcVal = parseFloat(String(ferroMap.get('TIBC')).replace(/[^0-9,.]/g,'').replace(',','.'));
      if (!isNaN(feVal) && !isNaN(tibcVal) && tibcVal > 0) {
        ferroMap.set('IST', Math.round(feVal / tibcVal * 100) + '%');
      }
    }

    // ── Insere diferencial no Leuco ──────────────────────────────
    // Ordem clínica: Blastos → Mielo → Metamielo → Basto → Seg → Eo → Baso → Linf → LinfR → Mono
    const DIF_ORDER = ['Blastos','Mielo','Metamielo','Basto','Seg','Eo','Baso','Linf','LinfR','Mono'];
    if (dif.size > 0) {
      const difParts = [];
      DIF_ORDER.forEach(k => { if (dif.has(k)) difParts.push(`${k} ${dif.get(k)}`); });
      dif.forEach((v, k) => { if (!DIF_ORDER.includes(k)) difParts.push(`${k} ${v}`); });
      const difStr = `(${difParts.join(', ')})`;
      if (groups['hemo'].has('Leuco')) {
        groups['hemo'].set('Leuco', groups['hemo'].get('Leuco') + ' ' + difStr);
      } else {
        groups['hemo'].set('Leuco', difStr);
      }
    }

    // ── Formata cada grupo — separador / entre todos os exames ───
    function fmtGroup(g) {
      const map = groups[g];
      if (!map || map.size === 0) return '';
      const ord = ORDER[g] || [];
      const parts = [];
      ord.forEach(k => { if (map.has(k)) parts.push(`${k} ${map.get(k)}`); });
      map.forEach((v, k) => { if (!ord.includes(k)) parts.push(`${k} ${v}`); });
      return parts.join(' / ');
    }

    const groupParts = PRIMARY.map(g => fmtGroup(g)).filter(Boolean);

    if (tail.length > 0 && groupParts.length > 0) {
      groupParts[groupParts.length - 1] += ' / ' + tail.join(' / ');
    } else if (tail.length > 0) {
      groupParts.push(tail.join(' / '));
    }

    const labsLine = groupParts.join(' / ');

    // ── Monta bloco de sorologias ────────────────────────────────
    const soroPos = sorologias.filter(s => s.positive).map(s => `${s.name}: ${s.fullVal}`);
    const soroNeg = sorologias.filter(s => !s.positive).map(s => `${s.name}: ${s.fullVal}`);
    let soroBlock = '';
    if (soroPos.length && soroNeg.length)  soroBlock = soroPos.join(', ') + ' | ' + soroNeg.join(', ');
    else if (soroPos.length)               soroBlock = soroPos.join(', ');
    else if (soroNeg.length)               soroBlock = soroNeg.join(', ');

    // ── Output final ─────────────────────────────────────────────
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
