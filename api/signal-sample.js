/**
 * Vercel 서버리스 함수: 스미싱 6대 위험 신호 가상 예시 이미지 생성 API (/api/signal-sample)
 * - google/gemma-4-26b-a4b-it:free 모델을 활용해 위험 신호별 가상 문자 캡처 이미지를 생성합니다.
 * - PRD 5.4 안전 규칙(예약 도메인, 가상 번호, 가상 명칭)을 준수하며 SVG 스마트폰 캡처 이미지 Data URL을 함께 제공합니다.
 */

import {
  callOpenRouterJson,
  parseJsonBody,
  sanitizeTrainingText
} from './_openrouter.js';

// 사용자가 지정한 모델 슬러그
export const GEMMA_MODEL_SLUG = 'google/gemma-4-26b-a4b-it:free';

// 6대 위험 신호 사전 정의 메타데이터 및 오프라인 고화질 백업 세트
export const BACKUP_SIGNAL_SAMPLES = {
  '01': {
    signalId: '01',
    signalName: '긴급성 압박',
    sender: '02-000-0000 (가상 번호)',
    receivedAt: '오늘 오후 2:15',
    message:
      '[○○기관] 본인 명의 계좌 사기 연루 신고 접수. 금일 18시까지 미확인 시 전 계좌 즉시 지급정지 및 자산 압류 처분 진행. 긴급 소명 확인: https://example.com/urgent-check',
    highlightPhrase: '금일 18시까지 미확인 시 전 계좌 즉시 지급정지',
    threatType: '마감 기한 협박 및 자산 압류 불안감 조성',
    explanation:
      '당일 마감, 계좌 지급정지, 즉시 구속 등 극단적 불이익을 내세워 피해자가 진위를 파악할 여유를 주지 않고 급하게 링크를 클릭하게 만드는 대표 수법입니다.',
    countermeasure:
      '수사기관과 공공기관은 문자로 계좌를 즉시 동결하거나 구속하겠다고 협박하지 않습니다. 문자를 무시하고 118(KISA) 또는 112로 신고하세요.'
  },
  '02': {
    signalId: '02',
    signalName: '기관·기업 사칭',
    sender: '02-000-0000 (가상 번호)',
    receivedAt: '오늘 오전 11:42',
    message:
      '[○○지검 형사3부] 귀하 사건번호(2026형제-0000) 관련 출석요구서 송달 불능. 피의 사건 공소장 및 증거 목록 열람: https://example.com/prosecutor',
    highlightPhrase: '[○○지검 형사3부] 귀하 사건번호(2026형제-0000)',
    threatType: '공권력 및 사법기관 공문서 사칭',
    explanation:
      '검찰청, 경찰청, 법원, 금융감독원 등의 공신력 있는 기관 명칭과 가짜 사건번호를 도용해 심리적 위압감을 조성하는 전형적인 수법입니다.',
    countermeasure:
      '검찰과 경찰은 사건 확인서나 출석요구서를 인터넷 링크로 보내지 않습니다. 링크를 누르지 말고 검찰 콜센터(1301)로 진위를 확인하세요.'
  },
  '03': {
    signalId: '03',
    signalName: '출처 불명 URL',
    sender: '000-0000-0000 (가상 번호)',
    receivedAt: '오늘 오후 1:08',
    message:
      '[○○택배] 고객님 배송지 불명확으로 화물 반송 처리 중입니다. 도로명 주소 정정 요청: https://example.com/kr-post-verify',
    highlightPhrase: 'https://example.com/kr-post-verify',
    threatType: '가짜 피싱 사이트로 연결하는 변종 URL',
    explanation:
      '공식 택배사나 쇼핑몰 도메인이 아닌 교묘하게 위장된 사설 인터넷 주소를 첨부하여, 클릭 시 개인정보 입력창이나 악성 로그인 화면으로 유도합니다.',
    countermeasure:
      '문자 속 URL은 절대 누르지 마세요. 주문한 내역이 있다면 구매한 공식 쇼핑몰 앱이나 택배사 공식 앱에서 배송 조회를 직접 진행해야 안전합니다.'
  },
  '04': {
    signalId: '04',
    signalName: '앱 설치 유도',
    sender: '000-0000-0000 (가상 번호)',
    receivedAt: '오늘 오전 10:25',
    message:
      '[○○은행 보안센터] 이상 금융거래(부정 로그인) 감지. 자산 보호를 위해 필수 보안 백신(SecGuard.apk) 설치 후 실행 요망: https://example.com/app/SecGuard.apk',
    highlightPhrase: '필수 보안 백신(SecGuard.apk) 설치 후 실행',
    threatType: '원격제어 악성 앱(APK) 설치 유포',
    explanation:
      '은행 보안 프로그램이나 정부 인증 앱으로 위장한 악성 APK 파일을 스마트폰에 설치하게 한 뒤, 통화·문자·카메라 권한을 가로채 금융 자산을 탈취합니다.',
    countermeasure:
      '금융기관과 공공기관은 절대로 문자 링크를 통해 보안 앱(APK) 설치를 요구하지 않습니다. 구글 플레이스토어 등 공식 스토어가 아니면 설치하지 마세요.'
  },
  '05': {
    signalId: '05',
    signalName: '개인정보 요구',
    sender: '000-0000-0000 (가상 번호)',
    receivedAt: '오늘 오후 3:30',
    message:
      '[○○지원센터] 2026 민생안정 지원금 2차 신청 안내. 본인인증을 위해 신분증 사본 등록 및 계좌비밀번호 입력이 필요합니다. https://example.com/apply-cert',
    highlightPhrase: '신분증 사본 등록 및 계좌비밀번호 입력',
    threatType: '신분증·계좌비밀번호 등 민감정보 탈취',
    explanation:
      '정부 지원금이나 정책대출 신청을 빙자하여 신분증 사진, 계좌 비밀번호, 공인인증서 비밀번호 등 핵심 금융정보를 직접 입력받아 가로채는 수법입니다.',
    countermeasure:
      '정상적인 정부 지원금 신청이나 금융 업무에서는 어떠한 경우에도 문자로 계좌 비밀번호나 보안카드 번호를 요구하지 않습니다. 100% 사기입니다.'
  },
  '06': {
    signalId: '06',
    signalName: '금전·송금 요구',
    sender: '000-0000-0000 (가상 번호)',
    receivedAt: '오늘 오후 4:12',
    message:
      '엄마 나 지금 휴대폰 액정 깨져서 수리 맡겼어. 지금 급하게 결제할 게 있는데 편의점 가서 문화상품권 50만원권 핀번호 사진 찍어 보내줘 https://example.com/pin',
    highlightPhrase: '문화상품권 50만원권 핀번호 사진 찍어 보내줘',
    threatType: '가족·지인 사칭 상품권 핀번호 및 금전 요구',
    explanation:
      '자녀나 지인의 휴대폰 파손을 핑계로 전화 확인을 피하며, 추적이 어려운 문화상품권 핀번호나 타인 명의 가상계좌로의 긴급 송금을 유도하는 메신저 피싱입니다.',
    countermeasure:
      '가족이라 하더라도 문자로 상품권 핀번호나 급한 송금을 요구하면 문자 내 링크나 번호로 연락하지 말고, 반드시 원래 저장된 전화번호로 직접 음성 통화해 확인하세요.'
  }
};

/**
 * 긴 텍스트를 SVG 내에서 적절한 너비로 감싸기 위한 텍스트 줄바꿈 헬퍼
 * @param {string} text 원본 텍스트
 * @param {number} maxCharsPerLine 한 줄당 최대 글자 수
 * @returns {string[]} 분할된 라인 배열
 */
function wrapSvgText(text, maxCharsPerLine = 22) {
  if (!text) return [];
  const lines = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxCharsPerLine) {
      lines.push(remaining);
      break;
    }
    let sliceEnd = maxCharsPerLine;
    const spaceIndex = remaining.lastIndexOf(' ', maxCharsPerLine);
    if (spaceIndex > maxCharsPerLine * 0.45) {
      sliceEnd = spaceIndex;
    }
    lines.push(remaining.slice(0, sliceEnd).trim());
    remaining = remaining.slice(sliceEnd).trim();
  }
  return lines;
}

/**
 * XML 특수문자 이스케이프 헬퍼
 * @param {string} str 원본 문자열
 * @returns {string} 안전한 XML 문자열
 */
function escapeXml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 가상 문자 시나리오 객체를 바탕으로 스마트폰 문자 수신 화면 형태의 정교한 SVG 이미지를 생성합니다.
 * @param {object} sample 시나리오 데이터 객체
 * @returns {string} SVG XML 문자열
 */
export function generateSignalSampleSvg(sample) {
  const signalId = escapeXml(sample.signalId || '01');
  const signalName = escapeXml(sample.signalName || '위험 신호');
  const sender = escapeXml(sample.sender || '000-0000-0000 (가상 번호)');
  const receivedAt = escapeXml(sample.receivedAt || '오늘 오후 2:15');
  const message = sample.message || '';
  const highlightPhrase = sample.highlightPhrase || '';
  const threatType = escapeXml(sample.threatType || '스미싱 의심 표현');

  const messageLines = wrapSvgText(message, 21);
  const bubbleHeight = Math.max(130, 48 + messageLines.length * 20 + 20);

  // SVG 조립
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 560" width="380" height="560">
  <defs>
    <!-- 스마트폰 베젤 그림자 -->
    <filter id="phoneShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.18" />
    </filter>
    <linearGradient id="bubbleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f8fafc" />
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>

  <!-- 1. 스마트폰 외곽 케이스 -->
  <rect x="8" y="8" width="364" height="544" rx="36" fill="#0f172a" stroke="#334155" stroke-width="2.5" filter="url(#phoneShadow)" />

  <!-- 2. 스마트폰 내부 디스플레이 화면 -->
  <rect x="18" y="18" width="344" height="524" rx="28" fill="#f1f5f9" />

  <!-- 3. 상단 카메라 노치 (다이나믹 아일랜드) -->
  <rect x="135" y="24" width="110" height="18" rx="9" fill="#020617" />
  <circle cx="230" cy="33" r="3.5" fill="#1e293b" />

  <!-- 4. 상태 표시줄 (Status Bar) -->
  <text x="42" y="37" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#0f172a">14:15</text>
  <!-- Wi-Fi & 배터리 아이콘 -->
  <path d="M 314 30 L 324 30 L 324 37 L 314 37 Z" fill="#0f172a" rx="1.5" />
  <rect x="325" y="32" width="2" height="3" rx="1" fill="#0f172a" />
  <path d="M 302 36 A 6 6 0 0 1 308 30 M 304 36 A 3 3 0 0 1 307 33" stroke="#0f172a" stroke-width="1.5" fill="none" stroke-linecap="round" />

  <!-- 5. 메시지 앱 상단 헤더 -->
  <rect x="18" y="48" width="344" height="52" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
  <path d="M 36 74 L 43 67 M 36 74 L 43 81" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="68" cy="74" r="15" fill="#e0e7ff" />
  <path d="M 64 74 A 4 4 0 0 1 72 74 A 4 4 0 0 1 64 74 Z M 62 82 A 6 6 0 0 1 74 82" stroke="#4338ca" stroke-width="1.6" fill="none" />
  
  <text x="92" y="69" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${sender}</text>
  <text x="92" y="84" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="10.5" fill="#64748b">문자메시지 · 가상 번호</text>

  <!-- 6. 위험 신호 안내 배너 -->
  <g transform="translate(30, 112)">
    <rect x="0" y="0" width="320" height="28" rx="6" fill="#fef2f2" stroke="#fecaca" stroke-width="1" />
    <circle cx="16" cy="14" r="6" fill="#ef4444" />
    <text x="16" y="17.5" font-family="-apple-system, sans-serif" font-size="9" font-weight="900" fill="#ffffff" text-anchor="middle">!</text>
    <text x="28" y="18" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="#b91c1c">신호 ${signalId} 탐지: ${signalName}</text>
  </g>

  <!-- 7. 수신 시각 표시 -->
  <text x="190" y="156" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10.5" fill="#94a3b8">${receivedAt}</text>

  <!-- 8. 수신 메시지 말풍선 -->
  <g transform="translate(30, 166)">
    <!-- 버블 배경 -->
    <rect x="0" y="0" width="320" height="${bubbleHeight}" rx="14" fill="url(#bubbleGrad)" stroke="#cbd5e1" stroke-width="1.2" />

    <!-- 본문 텍스트 -->
    <text x="16" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif" font-size="12" line-height="1.5" fill="#1e293b">`;

  messageLines.forEach((line, idx) => {
    const isHighlightLine = highlightPhrase && line.includes(highlightPhrase.slice(0, 8));
    if (isHighlightLine) {
      svg += `\n      <tspan x="16" dy="${idx === 0 ? 0 : 20}" font-weight="700" fill="#dc2626">${escapeXml(line)}</tspan>`;
    } else {
      svg += `\n      <tspan x="16" dy="${idx === 0 ? 0 : 20}">${escapeXml(line)}</tspan>`;
    }
  });

  svg += `
    </text>
  </g>

  <!-- 9. 위험 신호 하이라이트 분석 박스 (말풍선 하단 부착) -->
  <g transform="translate(30, ${176 + bubbleHeight})">
    <rect x="0" y="0" width="320" height="66" rx="8" fill="#fff1f2" stroke="#fda4af" stroke-width="1.2" />
    <text x="12" y="20" font-family="-apple-system, sans-serif" font-size="10.5" font-weight="800" fill="#be123c">위험 신호 핵심 분석</text>
    <text x="12" y="37" font-family="-apple-system, sans-serif" font-size="10.5" font-weight="600" fill="#881337">수법: ${threatType}</text>
    <text x="12" y="53" font-family="-apple-system, sans-serif" font-size="9.5" fill="#9f1239">핵심 구문: "${escapeXml(highlightPhrase.slice(0, 22))}${highlightPhrase.length > 22 ? '...' : ''}"</text>
  </g>

  <!-- 10. 안전 교육용 가상 시나리오 워터마크 -->
  <g transform="translate(30, 484)">
    <rect x="0" y="0" width="320" height="32" rx="6" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1" />
    <text x="160" y="20" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" fill="#1e40af">
      ClickCheck AI 안전 교육용 가상 이미지 (Gemma 4)
    </text>
  </g>

  <!-- 11. 하단 홈 인디케이터 바 -->
  <rect x="140" y="524" width="100" height="4" rx="2" fill="#94a3b8" />
</svg>`;

  return svg;
}

/**
 * Vercel 서버리스 핸들러 (/api/signal-sample)
 * @param {object} req HTTP 요청
 * @param {object} res HTTP 응답
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      errorCode: 'METHOD_NOT_ALLOWED',
      message: 'POST 요청만 지원합니다.'
    });
  }

  let requestedSignalId = '01';
  let requestedSignalName = '긴급성 압박';

  try {
    const body = await parseJsonBody(req);
    if (typeof body?.signalId === 'string' && body.signalId.trim()) {
      requestedSignalId = body.signalId.trim();
    }
    if (typeof body?.signalName === 'string' && body.signalName.trim()) {
      requestedSignalName = body.signalName.trim();
    }
  } catch {
    // 본문 파싱 실패 시 기본값 사용
  }

  // 1. 오프라인 폴백 샘플 확보
  const fallback =
    BACKUP_SIGNAL_SAMPLES[requestedSignalId] ||
    BACKUP_SIGNAL_SAMPLES['01'];

  // 2. OpenRouter 키가 없거나 비활성화된 경우 즉시 폴백 반환
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    const svg = generateSignalSampleSvg(fallback);
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return res.status(200).json({
      ok: true,
      source: 'fallback',
      model: GEMMA_MODEL_SLUG,
      sample: {
        ...fallback,
        svg,
        imageUrl
      }
    });
  }

  // 3. google/gemma-4-26b-a4b-it:free 모델을 통한 실시간 가상 예시 생성
  const systemPrompt = `당신은 한국어 스미싱 예방 교육 전문가입니다.
사용자가 특정 스미싱 위험 신호의 전형적인 수법을 한눈에 보고 학습할 수 있도록, 스마트폰 문자 화면에 표시될 교육용 가상 스미싱 문자 예시와 해설을 생성하세요.
반드시 순수 JSON 객체만 출력하세요.

[절대 준수 안전 규칙]
1. 실제 전화번호나 계좌번호를 쓰지 말고, "000-0000-0000" 또는 "02-000-0000" 같은 가상 번호만 사용하세요.
2. 실제 정부기관·기업·은행·택배사 이름을 쓰지 말고, 반드시 "○○기관", "○○택배", "○○은행", "○○지원센터" 같은 가상 명칭만 사용하세요.
3. 실제 작동하는 링크를 쓰지 말고, 반드시 "https://example.com/check" 같은 example.com 예약 도메인만 사용하세요.

[출력 JSON 스키마]
{
  "signalId": "${requestedSignalId}",
  "signalName": "${requestedSignalName}",
  "sender": "000-0000-0000 또는 02-000-0000 (가상 번호)",
  "receivedAt": "오늘 오후 2:15",
  "message": "스마트폰 화면에 표시될 가상 문자 내용 (가상 명칭과 example.com, 가상 번호만 사용)",
  "highlightPhrase": "문자 내용 중 해당 위험 신호에 직접 해당하는 핵심 구문 (message 안에 그대로 포함)",
  "threatType": "어떤 수법인지 한 줄 요약",
  "explanation": "왜 이것이 전형적인 해당 위험 신호인지 구체적인 설명 (2~3문장)",
  "countermeasure": "이런 문자를 받았을 때 안전한 대응 요령 (1~2문장)"
}`;

  const userPrompt = `위험 신호 번호: "${requestedSignalId}"
위험 신호 이름: "${requestedSignalName}"
요청 번호: ${Date.now() % 10000}

위 위험 신호가 적나라하게 드러나는 새로운 교육용 가상 스미싱 문자 1건을 JSON 스키마로 생성해 주세요.
반드시 실제 기관명·실제 도메인·실제 전화번호를 제외하고 가상 명칭(○○기관)과 example.com만 사용하세요.`;

  try {
    const result = await callOpenRouterJson({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: GEMMA_MODEL_SLUG,
      temperature: 0.6,
      maxTokens: 1000
    });

    const raw = result.data || {};
    const sanitizedMessage = sanitizeTrainingText(
      typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : fallback.message
    );
    const sanitizedSender = sanitizeTrainingText(
      typeof raw.sender === 'string' && raw.sender.trim()
        ? raw.sender.trim()
        : fallback.sender
    );
    const sanitizedHighlight = sanitizeTrainingText(
      typeof raw.highlightPhrase === 'string' && raw.highlightPhrase.trim()
        ? raw.highlightPhrase.trim()
        : fallback.highlightPhrase
    );

    const sample = {
      signalId: requestedSignalId,
      signalName: requestedSignalName,
      sender: sanitizedSender,
      receivedAt: raw.receivedAt || fallback.receivedAt,
      message: sanitizedMessage,
      highlightPhrase: sanitizedHighlight,
      threatType: sanitizeTrainingText(raw.threatType || fallback.threatType),
      explanation: sanitizeTrainingText(raw.explanation || fallback.explanation),
      countermeasure: sanitizeTrainingText(raw.countermeasure || fallback.countermeasure)
    };

    const svg = generateSignalSampleSvg(sample);
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    return res.status(200).json({
      ok: true,
      source: 'openrouter',
      model: result.model || GEMMA_MODEL_SLUG,
      latencyMs: result.latencyMs,
      sample: {
        ...sample,
        svg,
        imageUrl
      }
    });
  } catch (error) {
    // AI 호출 실패 시 안전하게 고화질 백업 샘플 반환
    const svg = generateSignalSampleSvg(fallback);
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    return res.status(200).json({
      ok: true,
      source: 'fallback',
      model: GEMMA_MODEL_SLUG,
      warning: error.message || 'AI 모델 호출 일시 제한으로 백업 예시를 불러왔습니다.',
      sample: {
        ...fallback,
        svg,
        imageUrl
      }
    });
  }
}
