/**
 * OpenRouter API 호출, JSON 파싱·검증, 위험 신호 원문 대조, 훈련 안전 규칙 후처리를 담당하는 서버 공용 모듈입니다.
 * 주의: 이 파일은 반드시 서버 측(api/ 폴더)에서만 실행되며 브라우저에 노출되지 않습니다.
 */

// OpenRouter Chat Completions 엔드포인트 주소
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// 환경 변수 미설정 시 사용할 기본 모델 슬러그 (PRD 5.2 기준)
export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';

// 허용된 위험 등급 목록
export const ALLOWED_RISK_LEVELS = ['안전', '주의', '위험'];

// 허용된 사기 유형 목록
export const ALLOWED_SCAM_TYPES = [
  '기관사칭',
  '택배',
  '지원금',
  '지인사칭',
  '대출',
  '기타',
  '해당없음'
];

// 훈련 모드에서 생성 가능한 사기 유형 목록
export const TRAIN_SCAM_TYPES = ['기관사칭', '택배', '지원금', '지인사칭', '대출'];

// 훈련 모드 난이도 목록
export const TRAIN_DIFFICULTIES = ['쉬움', '보통', '어려움'];

// 허용된 위험 신호 카테고리 목록 (PRD 5.3 기준)
export const ALLOWED_SIGNAL_CATEGORIES = [
  '긴급성',
  '기관사칭',
  'URL',
  '앱설치',
  '개인정보요구',
  '금전요구'
];

// 훈련 모드 고정 선택지 5종 (PRD 5.4 기준)
export const TRAINING_CHOICES = [
  '신고하기',
  '삭제하기',
  '링크 누르기',
  '적힌 번호로 전화하기',
  '가족에게 확인하기'
];

// 무료 모델 요청 제한·지연을 완화하기 위한 서버 메모리 캐시 (TTL: 10분)
const responseCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

/**
 * 현재 설정된 OpenRouter 모델 이름을 반환합니다.
 * @returns {string} 모델 슬러그
 */
export function getOpenRouterModel() {
  const configured = (process.env.OPENROUTER_MODEL || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  return configured || DEFAULT_OPENROUTER_MODEL;
}

/**
 * Vercel 서버리스 및 로컬 Node 환경 모두에서 요청 본문(JSON)을 안전하게 파싱합니다.
 * @param {object} req HTTP 요청 객체
 * @returns {Promise<object>} 파싱된 JSON 객체
 */
export async function parseJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
    const textBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8').trim()
      : String(req.body).trim();
    if (!textBody) return {};
    try {
      return JSON.parse(textBody);
    } catch {
      const err = new Error('요청 JSON 형식이 올바르지 않습니다.');
      err.statusCode = 400;
      err.errorCode = 'INVALID_JSON';
      throw err;
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('요청 JSON 형식이 올바르지 않습니다.');
    err.statusCode = 400;
    err.errorCode = 'INVALID_JSON';
    throw err;
  }
}

/**
 * 캐시에서 유효한 응답을 조회합니다.
 * @param {string} key 캐시 키
 * @returns {any|null} 캐시된 데이터 또는 null
 */
export function getCachedResult(key) {
  if (!key) return null;
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * 응답을 메모리 캐시에 저장합니다.
 * @param {string} key 캐시 키
 * @param {any} value 저장할 결과 객체
 */
export function setCachedResult(key, value) {
  if (!key) return;
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { createdAt: Date.now(), value });
}

/**
 * 모델이 반환한 원시 문자열에서 JSON 객체를 안전하게 추출·파싱합니다.
 * 코드 블록(```json)이나 앞뒤 설명 문구가 섞여 있어도 중괄호 균형을 추적해 추출합니다.
 * @param {string} rawText 모델 응답 문자열
 * @returns {object} 파싱된 JSON 객체
 */
export function extractJsonObject(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('모델 응답이 비어 있어 JSON을 파싱할 수 없습니다.');
  }

  // 마크다운 코드 펜스 제거
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // 전체 문자열 직접 파싱 시도
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  } catch {
    // 직접 파싱 실패 시 중괄호 범위 추출로 넘어갑니다.
  }

  // 문자열 내 첫 번째 '{'부터 중괄호 쌍이 닫히는 위치까지 추적
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) {
    throw new Error('응답에서 JSON 객체 시작 중괄호({)를 찾지 못했습니다.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = cleaned.slice(startIdx, i + 1);
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
          }
          break;
        }
      }
    }
  }

  throw new Error('유효한 JSON 객체 형식을 추출하지 못했습니다.');
}

/**
 * 위험 점수(0~100)와 위험 등급(안전/주의/위험)이 어긋날 경우 점수 기준으로 등급을 보정합니다.
 * (PRD 5.3: 점수와 등급이 어긋나면 앱에서 보정)
 * @param {number|string} rawScore 원시 위험 점수
 * @returns {{ risk_score: number, risk_level: string }} 보정된 점수와 등급
 */
export function reconcileRiskScoreAndLevel(rawScore) {
  const numeric = Number(rawScore);
  const clamped = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 50;

  let risk_level = '주의';
  if (clamped < 30) {
    risk_level = '안전';
  } else if (clamped >= 65) {
    risk_level = '위험';
  }

  return { risk_score: clamped, risk_level };
}

/**
 * 모델이 제시한 위험 신호(signals)가 실제 원문 문자열에 포함되는지 검증합니다.
 * 원문에 없는 환각 문구는 하이라이트 오류를 막기 위해 제외합니다. (PRD 5.3 검증 규칙)
 * @param {Array} signals 모델이 반환한 신호 배열
 * @param {string} sourceText 비교할 원문 텍스트
 * @returns {Array} 원문 대조를 통과한 신호 배열
 */
export function verifySignalsInSource(signals, sourceText) {
  if (!Array.isArray(signals) || typeof sourceText !== 'string' || !sourceText.trim()) {
    return [];
  }

  const verified = [];
  const seenTexts = new Set();

  for (const item of signals) {
    if (!item || typeof item !== 'object') continue;
    const rawPhrase = typeof item.text === 'string' ? item.text.trim() : '';
    if (!rawPhrase || rawPhrase.length < 2) continue;

    // 원문에 정확히 포함되는지 1차 확인
    let matchedText = '';
    if (sourceText.includes(rawPhrase)) {
      matchedText = rawPhrase;
    } else {
      // 줄바꿈/다중 공백 차이만 있는 경우 원문의 실제 부분 문자열을 찾아 매칭
      const escapedTokens = rawPhrase
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (escapedTokens.length > 0) {
        const fuzzyRegex = new RegExp(escapedTokens.join('\\s+'));
        const match = sourceText.match(fuzzyRegex);
        if (match && match[0]) {
          matchedText = match[0];
        }
      }
    }

    // 원문에서 확인되지 않은 문구는 환각으로 간주해 제외
    if (!matchedText || seenTexts.has(matchedText)) continue;
    seenTexts.add(matchedText);

    const category = ALLOWED_SIGNAL_CATEGORIES.includes(item.category)
      ? item.category
      : '긴급성';
    const reason =
      typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
        : '스미싱에서 자주 나타나는 의심 표현입니다.';

    verified.push({
      text: matchedText,
      category,
      reason
    });
  }

  return verified;
}

/**
 * 판별 모드 API 응답 객체를 PRD 5.3 스키마에 맞게 검증하고 정규화합니다.
 * @param {object} rawObj 모델이 반환한 파싱 JSON
 * @param {string} userText 사용자가 입력한 텍스트 (이미지 단독 입력 시 빈 문자열 가능)
 * @returns {object} 정규화된 판별 결과 객체
 */
export function validateAndNormalizeAnalyzeResult(rawObj, userText = '') {
  const { risk_score, risk_level } = reconcileRiskScoreAndLevel(rawObj?.risk_score);

  const scam_type = ALLOWED_SCAM_TYPES.includes(rawObj?.scam_type)
    ? rawObj.scam_type
    : risk_level === '안전'
      ? '해당없음'
      : '기타';

  // 이미지 입력인 경우 모델이 추출한 문자 원문을 기준으로 신호 검증
  const extractedText =
    typeof rawObj?.extracted_text === 'string' ? rawObj.extracted_text.trim() : '';
  const targetSourceText = userText.trim() ? userText : extractedText;

  const signals = verifySignalsInSource(rawObj?.signals, targetSourceText);

  // 행동 안내 배열 정규화
  let advice = Array.isArray(rawObj?.advice)
    ? rawObj.advice
        .filter((line) => typeof line === 'string' && line.trim())
        .map((line) => line.trim())
        .slice(0, 5)
    : [];

  if (advice.length === 0) {
    advice =
      risk_level === '안전'
        ? [
            '정상 안내 문자로 보이지만, 출처가 낯선 링크가 포함되어 있다면 직접 공식 앱으로 확인하세요.',
            '의심스러운 점이 남는다면 118(KISA) 또는 해당 기관 공식 대표번호로 확인하세요.'
          ]
        : [
            '문자에 포함된 인터넷 링크(URL)를 절대 누르지 마세요.',
            '문자에 적힌 번호로 전화하지 말고, 공식 앱이나 KISA 118·경찰청 112에 문의하세요.'
          ];
  }

  const summary =
    typeof rawObj?.summary === 'string' && rawObj.summary.trim()
      ? rawObj.summary.trim()
      : risk_level === '안전'
        ? '뚜렷한 스미싱 위험 신호가 발견되지 않았습니다.'
        : `${scam_type} 유형의 위험 신호가 감지되어 주의가 필요합니다.`;

  const easy_summary =
    typeof rawObj?.easy_summary === 'string' && rawObj.easy_summary.trim()
      ? rawObj.easy_summary.trim()
      : risk_level === '안전'
        ? '이 문자는 위험한 내용이 보이지 않아요. 그래도 모르는 인터넷 주소는 누르지 않는 것이 좋아요.'
        : '사기 문자일 가능성이 높아요. 문자에 있는 주소를 누르지 말고, 가족이나 118에 먼저 물어보세요.';

  return {
    risk_score,
    risk_level,
    scam_type,
    extracted_text: targetSourceText,
    summary,
    easy_summary,
    signals,
    advice
  };
}

/**
 * 훈련 모드 가상 문자의 안전 규칙(PRD 5.4)을 강제 적용하는 후처리 정화 함수입니다.
 * 실제 URL·전화번호·계좌번호·실제 기관명이 출력되면 예약 도메인/가상 번호/가상 명칭으로 치환합니다.
 * @param {string} text 정화할 텍스트
 * @returns {string} 안전 규칙이 적용된 텍스트
 */
export function sanitizeTrainingText(text) {
  if (typeof text !== 'string') return '';

  let safe = text;

  // 1. 예약 도메인(example.com/org/net/kr) 외의 실제 URL을 example.com으로 치환
  safe = safe.replace(
    /https?:\/\/(?!([a-z0-9-]+\.)?example\.(com|org|net|kr)\b)[^\s<>"')\]]+/gi,
    'https://example.com/check'
  );

  // 프로토콜 없는 도메인 형태도 예약 도메인이 아니면 치환
  safe = safe.replace(
    /\b(?!([a-z0-9-]+\.)?example\.(com|org|net|kr)\b)(?:[a-z0-9-]+\.)+(?:kr|com|net|org|io|me|ly|gg|co|info|biz)(?:\/[^\s<>"')\]]*)?/gi,
    'example.com/check'
  );

  // 2. 실제 전화번호 패턴(010, 지역번호, 1588 등)을 가상 번호로 치환
  safe = safe.replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '000-0000-0000');
  safe = safe.replace(/\b0(?:2|[3-6][1-5]|70)[-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '02-000-0000');
  safe = safe.replace(/\b1[568]\d{2}[-\s.]?\d{4}\b/g, '0000-0000');

  // 3. 계좌번호 형태(연속 숫자 그룹) 가상 번호로 치환
  safe = safe.replace(/\b\d{3,6}-\d{2,6}-\d{4,7}(?:-\d{1,3})?\b/g, '000-0000-0000-00');

  // 4. 실제 기관·은행·택배사 이름이 생성되었을 경우 가상 명칭으로 치환
  const realEntityReplacements = [
    [/(?:대검찰청|서울중앙지검|검찰청|경찰청|사이버수사대|국세청|법원|국민건강보험공단|건강보험공단|국민연금공단|행정안전부|금융감독원)/g, '○○기관'],
    [/(?:CJ대한통운|대한통운|우체국택배|우체국|한진택배|롯데택배|로젠택배|쿠팡로지스틱스)/g, '○○택배'],
    [/(?:KB국민은행|국민은행|신한은행|우리은행|하나은행|NH농협은행|농협은행|기업은행|IBK기업은행|카카오뱅크|토스뱅크|케이뱅크)/g, '○○은행']
  ];

  for (const [pattern, replacement] of realEntityReplacements) {
    safe = safe.replace(pattern, replacement);
  }

  return safe;
}

/**
 * 훈련 모드 API 응답 객체를 PRD 5.4 스키마와 안전 규칙에 맞게 검증·정규화합니다.
 * @param {object} rawObj 모델이 반환한 파싱 JSON
 * @param {string} requestedType 요청한 사기 유형
 * @param {string} requestedDifficulty 요청한 난이도
 * @returns {object} 검증된 훈련 시나리오 객체
 */
export function validateAndNormalizeTrainResult(rawObj, requestedType, requestedDifficulty) {
  const scam_type = TRAIN_SCAM_TYPES.includes(rawObj?.scam_type)
    ? rawObj.scam_type
    : TRAIN_SCAM_TYPES.includes(requestedType)
      ? requestedType
      : '기관사칭';

  const difficulty = TRAIN_DIFFICULTIES.includes(rawObj?.difficulty)
    ? rawObj.difficulty
    : TRAIN_DIFFICULTIES.includes(requestedDifficulty)
      ? requestedDifficulty
      : '보통';

  const message = sanitizeTrainingText(
    typeof rawObj?.message === 'string' && rawObj.message.trim()
      ? rawObj.message.trim()
      : `[${scam_type}] ○○기관 안내입니다. 본인 확인이 필요하니 https://example.com/check 에서 즉시 확인해 주세요. 문의: 000-0000-0000`
  );

  // 선택지는 PRD 5.4 기준 5개 고정 (정답/오답 일관성 보장)
  const safeBestCandidates = ['신고하기', '삭제하기', '가족에게 확인하기'];
  let best_choices = Array.isArray(rawObj?.best_choices)
    ? rawObj.best_choices.filter((choice) => safeBestCandidates.includes(choice))
    : [];

  if (best_choices.length === 0) {
    best_choices =
      scam_type === '지인사칭'
        ? ['가족에게 확인하기', '신고하기', '삭제하기']
        : ['신고하기', '삭제하기'];
  }

  // 훈련 신호 정화 및 원문 대조 검증
  const rawSignals = Array.isArray(rawObj?.signals)
    ? rawObj.signals.map((sig) => ({
        text: sanitizeTrainingText(sig?.text || ''),
        category: ALLOWED_SIGNAL_CATEGORIES.includes(sig?.category) ? sig.category : '긴급성',
        reason: sanitizeTrainingText(sig?.reason || '사기 문자에서 자주 쓰이는 유도 표현입니다.')
      }))
    : [];

  const signals = verifySignalsInSource(rawSignals, message);

  const explanation = sanitizeTrainingText(
    typeof rawObj?.explanation === 'string' && rawObj.explanation.trim()
      ? rawObj.explanation.trim()
      : `이 문자는 ${scam_type} 수법의 교육용 가상 예시입니다. 링크를 누르거나 문자 안의 번호로 전화하지 말고 삭제 후 신고하거나 가족과 공식 채널로 확인해야 합니다.`
  );

  const easy_explanation = sanitizeTrainingText(
    typeof rawObj?.easy_explanation === 'string' && rawObj.easy_explanation.trim()
      ? rawObj.easy_explanation.trim()
      : '가짜 안내 문자예요. 문자 속 주소를 누르지 말고 바로 지우거나 가족, 118에 먼저 물어보세요.'
  );

  return {
    scam_type,
    difficulty,
    message,
    choices: [...TRAINING_CHOICES],
    best_choices,
    signals,
    explanation,
    easy_explanation
  };
}

/**
 * 지정된 밀리초만큼 대기하는 유틸리티 함수입니다.
 * @param {number} ms 대기 시간(ms)
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenRouter Chat Completions API를 호출하고 JSON 응답을 파싱해 반환합니다.
 * 요청 제한(429) 및 일시 서버 오류(5xx) 발생 시 지수 백오프로 재시도합니다.
 * @param {object} params 호출 옵션
 * @param {Array} params.messages OpenAI 호환 메시지 배열
 * @param {number} params.temperature 샘플링 온도
 * @param {number} params.maxTokens 최대 출력 토큰
 * @param {string} [params.cacheKey] 캐시 키(선택)
 * @returns {Promise<{ data: object, cached: boolean, model: string, latencyMs: number }>}
 */
export async function callOpenRouterJson({
  messages,
  temperature = 0.2,
  maxTokens = 1400,
  cacheKey = ''
}) {
  // 1. 캐시 조회
  if (cacheKey) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      return {
        data: cached,
        cached: true,
        model: getOpenRouterModel(),
        latencyMs: 0
      };
    }
  }

  // 2. 서버 환경 변수에서 API 키 확인 (브라우저 노출 금지, 실수로 들어간 앞뒤 따옴표 제거)
  const apiKey = (process.env.OPENROUTER_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!apiKey) {
    const err = new Error(
      'OPENROUTER_API_KEY가 설정되지 않았습니다. .env.local 또는 배포 환경 변수에 키를 등록해 주세요.'
    );
    err.statusCode = 503;
    err.errorCode = 'API_KEY_MISSING';
    throw err;
  }

  const model = getOpenRouterModel();
  // Vercel maxDuration(30초) 안에 안정적으로 응답/오류를 반환할 수 있도록 시도 횟수·타임아웃 조정
  const maxAttempts = 2;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 11000);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.APP_URL || 'https://safetext-trainer.vercel.app',
          'X-Title': 'SafeText Trainer'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // 요청 제한(429) 또는 일시 장애(5xx) 시 재시도
      if (response.status === 429 || response.status >= 500) {
        const errBody = await response.text().catch(() => '');
        const retryableErr = new Error(
          response.status === 429
            ? '무료 모델 요청 한도에 일시적으로 도달했습니다. 잠시 후 다시 시도해 주세요.'
            : `OpenRouter 서버 응답 오류(${response.status})가 발생했습니다.`
        );
        retryableErr.statusCode = response.status === 429 ? 429 : 502;
        retryableErr.errorCode = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
        retryableErr.detail = errBody.slice(0, 300);
        lastError = retryableErr;

        if (attempt < maxAttempts) {
          await delay(450 * attempt);
          continue;
        }
        throw retryableErr;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const fatalErr = new Error(
          response.status === 401
            ? 'OpenRouter API 키 인증에 실패했습니다(401). 키가 폐기·만료되었거나 앞뒤 공백·따옴표가 들어갔는지 확인해 주세요.'
            : `OpenRouter 요청이 거부되었습니다(${response.status}).`
        );
        fatalErr.statusCode = response.status === 401 ? 401 : 502;
        fatalErr.errorCode = response.status === 401 ? 'INVALID_API_KEY' : 'UPSTREAM_REJECTED';
        fatalErr.detail = errBody.slice(0, 300);
        throw fatalErr;
      }

      const payload = await response.json();
      const rawContent = payload?.choices?.[0]?.message?.content;
      const textContent = Array.isArray(rawContent)
        ? rawContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
        : String(rawContent || '');

      // JSON 추출 실패 시 재시도 기회 활용
      const parsed = extractJsonObject(textContent);

      if (cacheKey) {
        setCachedResult(cacheKey, parsed);
      }

      return {
        data: parsed,
        cached: false,
        model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const isAbort = error?.name === 'AbortError';
      if (isAbort) {
        lastError = new Error('AI 응답 시간이 초과되었습니다. 네트워크 상태를 확인하거나 다시 시도해 주세요.');
        lastError.statusCode = 504;
        lastError.errorCode = 'TIMEOUT';
      } else {
        lastError = error;
      }

      if (attempt < maxAttempts && (!error?.statusCode || error.statusCode >= 500 || error.statusCode === 429)) {
        await delay(450 * attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('OpenRouter 호출에 실패했습니다.');
}
