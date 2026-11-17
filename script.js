/**
 * SafeText Trainer 프론트엔드 순수 자바스크립트 모듈
 * - 외부 프레임워크나 빌드 도구 없이 브라우저 DOM API만으로 판별·훈련·융합 흐름을 제어합니다.
 * - OpenRouter API는 직접 호출하지 않고 반드시 /api/* 서버리스 엔드포인트를 통해서만 통신합니다.
 */

// 시연 및 빠른 체험용 가상 문자 샘플 (PRD 9 시연 시나리오 기준)
const DEMO_SAMPLES = {
  agency: {
    label: '기관사칭 사기',
    text: '[○○기관] 사건번호 2026-418호 명의도용 피해 관련 즉시 출석요구서 열람 필요. 오늘까지 확인하지 않을 시 계좌 지급정지 처리됩니다. 확인: https://example.com/notice'
  },
  delivery: {
    label: '택배 사칭 사기',
    text: '[○○택배] 고객님 주소지 불명확으로 배송 보류 중입니다. 보관 기간 만료 전 배송지 수정 바랍니다. https://example.com/delivery-fix'
  },
  normal: {
    label: '정상 입금 알림',
    text: '[Web발신] ○○은행 입출금 알림 홍*동님 계좌로 250,000원이 입금되었습니다. 잔액 1,140,000원'
  }
};

// API 키 미설정 또는 무료 모델 요청 제한 시 백업으로 제공하는 시연용 고정 판별 결과
const BACKUP_ANALYZE_RESULTS = {
  agency: {
    risk_score: 91,
    risk_level: '위험',
    scam_type: '기관사칭',
    summary:
      '공공기관을 사칭해 계좌 지급정지라는 긴급한 불이익을 암시하고, 공식 기관 안내 문자에서 사용하지 않는 외부 링크 클릭을 유도하는 전형적인 스미싱입니다.',
    easy_summary:
      '공공기관을 흉내 낸 위험한 사기 문자예요. 주소(링크)를 절대 누르지 말고 바로 지운 뒤 118 또는 112에 확인하세요.',
    signals: [
      {
        text: '[○○기관]',
        category: '기관사칭',
        reason: '신뢰도가 높은 공공기관 명칭을 앞세워 피해자의 경계심을 낮춥니다.'
      },
      {
        text: '오늘까지 확인하지 않을 시 계좌 지급정지',
        category: '긴급성',
        reason: '촉박한 기한과 금융 불이익을 언급해 침착한 확인을 방해합니다.'
      },
      {
        text: 'https://example.com/notice',
        category: 'URL',
        reason: '정부·공공기관의 공식 안내 문자는 링크(URL)를 포함하지 않습니다.'
      }
    ],
    advice: [
      '문자에 포함된 URL을 절대 누르지 마세요.',
      '문자 안의 번호로 전화하지 말고 KISA(118) 또는 경찰청(112)에 사실 여부를 문의하세요.',
      '이미 링크를 눌러 앱 설치 파일이 내려받아졌다면 즉시 삭제하고 스마트폰 보안 점검을 받으세요.'
    ]
  },
  delivery: {
    risk_score: 84,
    risk_level: '위험',
    scam_type: '택배',
    summary:
      '배송 보류와 보관 기간 만료를 내세워 링크 접속 및 배송지 수정을 유도하는 택배 사칭 스미싱 유형입니다.',
    easy_summary:
      '가짜 택배 안내 문자예요. 문자 속 주소를 누르지 말고 택배 회사 공식 앱에서 직접 조회하세요.',
    signals: [
      {
        text: '[○○택배]',
        category: '기관사칭',
        reason: '일상적으로 자주 받는 택배 알림으로 위장해 자연스럽게 클릭을 유도합니다.'
      },
      {
        text: '보관 기간 만료 전',
        category: '긴급성',
        reason: '시간 제한을 걸어 사용자가 공식 앱으로 확인하기 전에 링크를 누르게 합니다.'
      },
      {
        text: 'https://example.com/delivery-fix',
        category: 'URL',
        reason: '피싱 페이지 또는 악성 앱 설치로 이어질 수 있는 출처 불명 링크입니다.'
      }
    ],
    advice: [
      '문자 속 링크를 누르지 말고 주문한 쇼핑몰이나 공식 택배 앱에서 송장 번호를 직접 조회하세요.',
      '의심 문자는 삭제하고 수신 차단 또는 KISA(118)에 신고하세요.'
    ]
  },
  normal: {
    risk_score: 8,
    risk_level: '안전',
    scam_type: '해당없음',
    summary:
      '단순 거래 입금 내역 알림으로 외부 URL, 앱 설치 유도, 개인정보나 송금 요구 표현이 발견되지 않았습니다.',
    easy_summary:
      '정상적인 은행 입금 알림 문자예요. 위험한 주소나 돈을 보내라는 내용이 보이지 않아요.',
    signals: [],
    advice: [
      '정상 안내 문자로 보이지만, 실제 거래 여부가 헷갈린다면 은행 공식 앱에서 입출금 내역을 직접 확인하세요.'
    ]
  }
};

// 백업용 교육 가상 시나리오 세트 (PRD 5.4 안전 규칙 준수)
const BACKUP_TRAINING_SCENARIOS = {
  기관사칭: {
    scam_type: '기관사칭',
    difficulty: '보통',
    message:
      '[○○기관] 귀하의 명의로 개설된 대포통장이 적발되어 긴급 조사가 필요합니다. 사건 확인서 열람: https://example.com/verify (문의: 02-0000-0000)',
    choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
    best_choices: ['신고하기', '삭제하기'],
    signals: [
      {
        text: '[○○기관]',
        category: '기관사칭',
        reason: '공공·수사기관을 사칭해 심리적 압박감을 줍니다.'
      },
      {
        text: '긴급 조사가 필요합니다',
        category: '긴급성',
        reason: '당황하게 만들어 공식 절차 확인 없이 행동하게 유도합니다.'
      },
      {
        text: 'https://example.com/verify',
        category: 'URL',
        reason: '공공기관 문자는 사건 확인용 URL 링크를 보내지 않습니다.'
      }
    ],
    explanation:
      '수사기관이나 공공기관은 문자로 사건 확인서 링크를 보내지 않습니다. 링크를 누르거나 적힌 번호로 전화하지 말고 삭제 후 118 또는 112에 신고해야 합니다.',
    easy_explanation:
      '기관을 사칭한 가짜 문자예요. 주소를 누르거나 전화하지 말고 바로 지우고 신고하세요.'
  },
  택배: {
    scam_type: '택배',
    difficulty: '쉬움',
    message:
      '[○○택배] 도로명 주소 불일치로 물품 반송 예정입니다. 오늘 안으로 주소 확인 바랍니다. https://example.com/parcel',
    choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
    best_choices: ['신고하기', '삭제하기'],
    signals: [
      {
        text: '물품 반송 예정',
        category: '긴급성',
        reason: '반송 불이익을 내세워 조급한 클릭을 유도합니다.'
      },
      {
        text: 'https://example.com/parcel',
        category: 'URL',
        reason: '문자 속 주소 대신 쇼핑몰 공식 앱에서 배송 상태를 확인해야 합니다.'
      }
    ],
    explanation:
      '주문한 물품이 있더라도 문자 링크로 주소를 수정하면 안 됩니다. 문자는 삭제·신고하고 구매처 앱에서 배송 내역을 확인하세요.',
    easy_explanation:
      '택배 문자의 주소는 누르지 마세요. 물건을 산 앱에 직접 들어가서 확인하는 것이 안전해요.'
  },
  지원금: {
    scam_type: '지원금',
    difficulty: '보통',
    message:
      '[○○지원센터] 2026년도 민생안정 지원금 신청 대상자입니다. 마감 임박으로 https://example.com/grant 에서 본인 인증 후 수령하세요.',
    choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
    best_choices: ['신고하기', '삭제하기'],
    signals: [
      {
        text: '마감 임박',
        category: '긴급성',
        reason: '신청 기한이 곧 끝난다는 표현으로 판단을 서두르게 만듭니다.'
      },
      {
        text: 'https://example.com/grant',
        category: 'URL',
        reason: '정부 지원금 안내는 공식 홈페이지나 정부 앱을 통해 직접 확인해야 합니다.'
      }
    ],
    explanation:
      '지원금 신청을 빙자해 개인정보와 금융정보를 탈취하는 대표 수법입니다. 문자 링크에 접속하지 말고 삭제 후 신고하세요.',
    easy_explanation:
      '지원금을 준다는 문자의 주소는 가짜일 수 있어요. 절대 누르지 말고 지우세요.'
  },
  지인사칭: {
    scam_type: '지인사칭',
    difficulty: '어려움',
    message:
      '엄마 나 핸드폰 액정 깨져서 수리 맡겼어. 지금 급하게 결제할 게 있는데 000-0000-0000-00(○○은행) 계좌로 50만 원만 먼저 보내줄 수 있어?',
    choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
    best_choices: ['가족에게 확인하기', '신고하기', '삭제하기'],
    signals: [
      {
        text: '핸드폰 액정 깨져서',
        category: '기관사칭',
        reason: '통화가 어렵다는 핑계로 본인 음성 확인을 피하려는 전형적 수법입니다.'
      },
      {
        text: '50만 원만 먼저 보내줄 수 있어?',
        category: '금전요구',
        reason: '타인 계좌나 급한 이체를 요구하며 금전 탈취를 시도합니다.'
      }
    ],
    explanation:
      '가족이나 지인이 휴대전화 고장을 이유로 금전 이체를 부탁하면 반드시 기존에 저장된 번호로 직접 통화하거나 다른 가족에게 먼저 확인해야 합니다.',
    easy_explanation:
      '가족이 돈을 보내달라고 해도 문자만 보고 보내면 안 돼요. 원래 알던 번호로 직접 전화해서 확인하세요.'
  },
  대출: {
    scam_type: '대출',
    difficulty: '보통',
    message:
      '[○○은행] 정부지원 저금리 대환대출 특별 대상자 선정. 기존 고금리 상환 후 한도 상향 가능. 상담: 000-0000-0000 / 신청: https://example.com/loan',
    choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
    best_choices: ['신고하기', '삭제하기'],
    signals: [
      {
        text: '저금리 대환대출 특별 대상자',
        category: '금전요구',
        reason: '선이자나 기존 대출 상환 명목으로 금전을 요구하는 미끼 문구입니다.'
      },
      {
        text: 'https://example.com/loan',
        category: 'URL',
        reason: '원격제어 앱이나 가짜 금융 앱 설치 링크로 연결될 위험이 큽니다.'
      }
    ],
    explanation:
      '금융회사는 문자로 특별 저금리 대환대출을 권유하며 링크 접속이나 선입금을 요구하지 않습니다. 바로 삭제하고 신고하세요.',
    easy_explanation:
      '싼 이자로 대출해 준다는 문자는 사기일 가능성이 커요. 주소를 누르거나 전화하지 마세요.'
  }
};

// 애플리케이션 상태 관리 객체
const state = {
  activeMode: 'analyze', // 'analyze' | 'train'
  easyMode: false,
  hasApiKey: true,
  demoModeForced: false,
  selectedImageDataUrl: '',
  selectedDifficulty: '보통',
  lastAnalyzePayload: null,
  lastAnalyzeResult: null,
  currentScenario: null,
  currentScenarioSource: 'openrouter',
  scenarioAnswered: false,
  sessionStats: {
    score: 0,
    total: 0,
    correct: 0
  }
};

// DOM 요소 참조 모음 (브라우저 환경에서 initDomRefs 호출 시 초기화됨)
let el = {};

/**
 * 브라우저 DOM 요소 참조를 초기화합니다.
 */
function initDomRefs() {
  el = {
    headerDemoBtn: document.getElementById('btn-header-demo'),
    easyModeBtn: document.getElementById('btn-easy-mode'),
    statScore: document.getElementById('stat-score'),
    statAccuracy: document.getElementById('stat-accuracy'),
    statCount: document.getElementById('stat-count'),

    apiStatusBanner: document.getElementById('api-status-banner'),
    apiStatusText: document.getElementById('api-status-text'),
    toggleDemoModeBtn: document.getElementById('btn-toggle-demo-mode'),

    tabAnalyze: document.getElementById('tab-analyze'),
    tabTrain: document.getElementById('tab-train'),
    panelAnalyze: document.getElementById('panel-analyze'),
    panelTrain: document.getElementById('panel-train'),
    activeModeCaption: document.getElementById('active-mode-caption'),

    smsInput: document.getElementById('sms-input'),
    charCount: document.getElementById('char-count'),
    maskPiiBtn: document.getElementById('btn-mask-pii'),
    clearInputBtn: document.getElementById('btn-clear-input'),
    imageInput: document.getElementById('image-input'),
    imageFileName: document.getElementById('image-file-name'),
    removeImageBtn: document.getElementById('btn-remove-image'),
    imagePreviewWrap: document.getElementById('image-preview-wrap'),
    imagePreview: document.getElementById('image-preview'),
    analyzeBtn: document.getElementById('btn-analyze'),

    analyzeEmpty: document.getElementById('analyze-empty'),
    analyzeLoading: document.getElementById('analyze-loading'),
    analyzeError: document.getElementById('analyze-error'),
    analyzeErrorMsg: document.getElementById('analyze-error-message'),
    retryAnalyzeBtn: document.getElementById('btn-retry-analyze'),
    useDemoAnalyzeBtn: document.getElementById('btn-use-demo-analyze'),
    analyzeResult: document.getElementById('analyze-result'),

    resScore: document.getElementById('res-score'),
    resGradeBadge: document.getElementById('res-grade-badge'),
    resGradeIcon: document.getElementById('res-grade-icon'),
    resGradeText: document.getElementById('res-grade-text'),
    resScamType: document.getElementById('res-scam-type'),
    resSourceLabel: document.getElementById('res-source-label'),
    resSummary: document.getElementById('res-summary'),
    resHighlightedText: document.getElementById('res-highlighted-text'),
    resSignalsList: document.getElementById('res-signals-list'),
    resAdviceList: document.getElementById('res-advice-list'),
    bridgeTrainHint: document.getElementById('bridge-train-hint'),
    practiceSimilarBtn: document.getElementById('btn-practice-similar'),

    trainTypeSelect: document.getElementById('train-type-select'),
    generateScenarioBtn: document.getElementById('btn-generate-scenario'),
    trainMetaTag: document.getElementById('train-meta-tag'),
    trainLoading: document.getElementById('train-loading'),
    trainError: document.getElementById('train-error'),
    trainErrorMsg: document.getElementById('train-error-message'),
    retryTrainBtn: document.getElementById('btn-retry-train'),
    useDemoTrainBtn: document.getElementById('btn-use-demo-train'),
    trainScenarioView: document.getElementById('train-scenario-view'),
    trainSourceLabel: document.getElementById('train-source-label'),
    trainMessageBox: document.getElementById('train-message-box'),
    trainChoices: document.getElementById('train-choices'),

    trainFeedbackEmpty: document.getElementById('train-feedback-empty'),
    trainFeedbackResult: document.getElementById('train-feedback-result'),
    trainVerdictBox: document.getElementById('train-verdict-box'),
    trainVerdictTitle: document.getElementById('train-verdict-title'),
    trainVerdictScore: document.getElementById('train-verdict-score'),
    trainBestChoices: document.getElementById('train-best-choices'),
    trainExplanation: document.getElementById('train-explanation'),
    trainSignalsList: document.getElementById('train-signals-list'),
    sendToAnalyzeBtn: document.getElementById('btn-send-to-analyze'),
    nextScenarioBtn: document.getElementById('btn-next-scenario')
  };
}

/**
 * 입력 문자열 내 전화번호·계좌번호·주민등록번호 패턴을 로컬에서 마스킹합니다.
 * @param {string} text 원본 문자 내용
 * @returns {string} 마스킹된 문자 내용
 */
export function maskPersonalInfo(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[주민번호]')
    .replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '[전화번호]')
    .replace(/\b\d{3,6}-\d{2,6}-\d{4,7}(?:-\d{1,3})?\b/g, '[계좌번호]');
}

/**
 * 세션 스토리지에서 누적 훈련 점수를 복원하고 UI를 갱신합니다.
 */
function loadSessionStats() {
  try {
    const saved = sessionStorage.getItem('safetext_session_stats');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed?.score === 'number' &&
        typeof parsed?.total === 'number' &&
        typeof parsed?.correct === 'number'
      ) {
        state.sessionStats = parsed;
      }
    }
  } catch {
    // 스토리지 접근 불가 환경에서는 기본값 유지
  }
  renderSessionStats();
}

/**
 * 누적 훈련 점수 UI와 세션 스토리지를 업데이트합니다.
 */
function renderSessionStats() {
  const { score, total, correct } = state.sessionStats;
  el.statScore.textContent = String(score);
  el.statCount.textContent = String(total);
  el.statAccuracy.textContent = total > 0 ? `${Math.round((correct / total) * 100)}%` : '—';

  try {
    sessionStorage.setItem('safetext_session_stats', JSON.stringify(state.sessionStats));
  } catch {
    // 무시
  }
}

/**
 * 판별/훈련 탭 모드를 전환합니다.
 * @param {'analyze'|'train'} mode 전환할 모드
 */
function switchMode(mode) {
  state.activeMode = mode;
  const isAnalyze = mode === 'analyze';

  el.tabAnalyze.classList.toggle('is-active', isAnalyze);
  el.tabAnalyze.setAttribute('aria-selected', String(isAnalyze));
  el.tabTrain.classList.toggle('is-active', !isAnalyze);
  el.tabTrain.setAttribute('aria-selected', String(!isAnalyze));

  el.panelAnalyze.classList.toggle('hidden', !isAnalyze);
  el.panelTrain.classList.toggle('hidden', isAnalyze);

  el.activeModeCaption.textContent = isAnalyze
    ? '의심 문자·캡처 이미지를 입력하면 위험 점수와 원문 위험 표현을 분석합니다.'
    : '유형·난이도별 교육용 가상 문자를 보고 가장 안전한 대응 방법을 선택해 보세요.';

  // 훈련 모드 최초 진입 시 기본 시나리오가 없으면 바로 준비
  if (!isAnalyze && !state.currentScenario) {
    generateTrainingScenario();
  }
}

/**
 * 쉬운 말 안내 모드를 전환하고 현재 열린 결과 문구를 다시 반영합니다.
 */
function toggleEasyMode() {
  state.easyMode = !state.easyMode;
  el.easyModeBtn.setAttribute('aria-pressed', String(state.easyMode));
  el.easyModeBtn.textContent = state.easyMode ? '쉬운 말 안내: 켬' : '쉬운 말 안내: 끔';

  if (state.lastAnalyzeResult) {
    renderAnalyzeResult(state.lastAnalyzeResult.data, state.lastAnalyzeResult.meta);
  }
  if (state.currentScenario && state.scenarioAnswered) {
    el.trainExplanation.textContent = state.easyMode
      ? state.currentScenario.easy_explanation || state.currentScenario.explanation
      : state.currentScenario.explanation;
  }
}

/**
 * 판별 패널의 표시 상태(empty | loading | error | result)를 제어합니다.
 * @param {'empty'|'loading'|'error'|'result'} viewState 표시할 상태
 */
function setAnalyzeViewState(viewState) {
  el.analyzeEmpty.classList.toggle('hidden', viewState !== 'empty');
  el.analyzeLoading.classList.toggle('hidden', viewState !== 'loading');
  el.analyzeError.classList.toggle('hidden', viewState !== 'error');
  el.analyzeResult.classList.toggle('hidden', viewState !== 'result');
}

/**
 * 훈련 패널의 표시 상태(loading | error | ready)를 제어합니다.
 * @param {'loading'|'error'|'ready'} viewState 표시할 상태
 */
function setTrainViewState(viewState) {
  el.trainLoading.classList.toggle('hidden', viewState !== 'loading');
  el.trainError.classList.toggle('hidden', viewState !== 'error');
  el.trainScenarioView.classList.toggle('hidden', viewState !== 'ready');
}

/**
 * 원문 텍스트 안에 verified signals[].text를 안전하게 <mark> 요소로 하이라이트해 렌더링합니다.
 * innerHTML 대신 DOM 텍스트 노드를 직접 생성해 XSS를 방지하고 원문 일치 부분만 강조합니다.
 * @param {HTMLElement} container 렌더링 대상 DOM 컨테이너
 * @param {string} sourceText 원문 텍스트
 * @param {Array} signals 검증된 위험 신호 목록
 * @param {Function} [onMarkClick] 하이라이트 클릭 콜백
 */
function renderHighlightedMessage(container, sourceText, signals, onMarkClick) {
  container.textContent = '';

  if (!sourceText) {
    container.textContent = '(문자 원문 없음)';
    return;
  }

  if (!Array.isArray(signals) || signals.length === 0) {
    container.textContent = sourceText;
    return;
  }

  // 원문 내 실제 위치(start, end)를 찾아 겹치지 않게 정렬
  const spans = [];
  signals.forEach((signal, index) => {
    if (!signal?.text) return;
    const start = sourceText.indexOf(signal.text);
    if (start !== -1) {
      spans.push({
        start,
        end: start + signal.text.length,
        signal,
        index
      });
    }
  });

  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  // 겹치는 구간 제거
  const nonOverlapping = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start >= cursor) {
      nonOverlapping.push(span);
      cursor = span.end;
    }
  }

  let currentIndex = 0;
  for (const span of nonOverlapping) {
    if (span.start > currentIndex) {
      container.appendChild(document.createTextNode(sourceText.slice(currentIndex, span.start)));
    }

    const mark = document.createElement('mark');
    mark.className = 'signal-mark';
    mark.dataset.category = span.signal.category || '긴급성';
    mark.dataset.signalIdx = String(span.index);
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-label', `${span.signal.category} 위험 신호: ${span.signal.text}`);
    mark.textContent = sourceText.slice(span.start, span.end);

    if (typeof onMarkClick === 'function') {
      mark.addEventListener('click', () => onMarkClick(span.index));
      mark.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          onMarkClick(span.index);
        }
      });
    }

    container.appendChild(mark);
    currentIndex = span.end;
  }

  if (currentIndex < sourceText.length) {
    container.appendChild(document.createTextNode(sourceText.slice(currentIndex)));
  }
}

/**
 * 위험 등급에 맞는 SVG 아이콘 마크업을 반환합니다.
 * (색상만으로 상태를 전달하지 않기 위한 접근성 규칙 준수)
 * @param {string} level '안전' | '주의' | '위험'
 * @returns {string} SVG 문자열
 */
function getGradeIconSvg(level) {
  if (level === '위험') {
    return '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>';
  }
  if (level === '주의') {
    return '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>';
  }
  return '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>';
}

/**
 * 탐지된 위험 신호 목록(<ul>)을 DOM으로 렌더링합니다.
 * @param {HTMLUListElement} listEl 대상 목록 요소
 * @param {Array} signals 신호 배열
 */
function renderSignalsList(listEl, signals) {
  listEl.textContent = '';

  if (!Array.isArray(signals) || signals.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'signal-item';
    emptyLi.textContent = '원문에서 뚜렷한 스미싱 위험 표현이 검출되지 않았습니다.';
    listEl.appendChild(emptyLi);
    return;
  }

  signals.forEach((sig, index) => {
    const li = document.createElement('li');
    li.className = 'signal-item';
    li.dataset.signalIdx = String(index);

    const head = document.createElement('div');
    head.className = 'signal-item-head';

    const cat = document.createElement('span');
    cat.className = 'signal-cat';
    cat.textContent = `[${sig.category || '의심 표현'}]`;

    const quote = document.createElement('span');
    quote.className = 'signal-quote';
    quote.textContent = `"${sig.text}"`;

    head.appendChild(cat);
    head.appendChild(quote);

    const reason = document.createElement('p');
    reason.className = 'signal-reason';
    reason.textContent = sig.reason;

    li.appendChild(head);
    li.appendChild(reason);
    listEl.appendChild(li);
  });
}

/**
 * 특정 위험 신호 인덱스를 하이라이트와 설명 목록 양쪽에서 강조 표시합니다.
 * @param {number} targetIndex 선택된 신호 인덱스
 */
function focusSignalItem(targetIndex) {
  const marks = el.resHighlightedText.querySelectorAll('.signal-mark');
  marks.forEach((m) => {
    m.classList.toggle('is-focused', Number(m.dataset.signalIdx) === targetIndex);
  });

  const items = el.resSignalsList.querySelectorAll('.signal-item');
  items.forEach((item) => {
    const matched = Number(item.dataset.signalIdx) === targetIndex;
    item.classList.toggle('is-focused', matched);
    if (matched) {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

/**
 * 판별 결과를 화면에 렌더링합니다.
 * @param {object} result 정규화된 판별 결과 객체
 * @param {object} meta 출처·모델·지연 시간 메타 정보
 */
function renderAnalyzeResult(result, meta) {
  state.lastAnalyzeResult = { data: result, meta };

  el.resScore.textContent = String(result.risk_score);
  el.resGradeText.textContent = result.risk_level;
  el.resGradeIcon.innerHTML = getGradeIconSvg(result.risk_level);

  el.resGradeBadge.classList.remove('grade-safe', 'grade-caution', 'grade-danger');
  if (result.risk_level === '위험') {
    el.resGradeBadge.classList.add('grade-danger');
  } else if (result.risk_level === '주의') {
    el.resGradeBadge.classList.add('grade-caution');
  } else {
    el.resGradeBadge.classList.add('grade-safe');
  }

  el.resScamType.textContent = result.scam_type || '해당없음';

  const sourceParts = [];
  if (meta?.source === 'demo') {
    sourceParts.push('시연용 고정 예시 (오프라인 백업)');
  } else {
    sourceParts.push('OpenRouter 실시간 분석');
    if (meta?.cached) sourceParts.push('캐시 응답');
    if (typeof meta?.latencyMs === 'number' && meta.latencyMs > 0) {
      sourceParts.push(`${(meta.latencyMs / 1000).toFixed(1)}초`);
    }
  }
  el.resSourceLabel.textContent = sourceParts.join(' · ');

  el.resSummary.textContent = state.easyMode
    ? result.easy_summary || result.summary
    : result.summary;

  const sourceText = result.extracted_text || el.smsInput.value.trim();
  renderHighlightedMessage(el.resHighlightedText, sourceText, result.signals, focusSignalItem);
  renderSignalsList(el.resSignalsList, result.signals);

  el.resAdviceList.textContent = '';
  (result.advice || []).forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    el.resAdviceList.appendChild(li);
  });

  // 판별 -> 훈련 연결 문구 업데이트
  const trainableTypes = ['기관사칭', '택배', '지원금', '지인사칭', '대출'];
  const mappedType = trainableTypes.includes(result.scam_type) ? result.scam_type : '기관사칭';
  el.practiceSimilarBtn.dataset.targetType = mappedType;
  el.bridgeTrainHint.textContent =
    result.risk_level === '안전'
      ? '예방 차원에서 대표적인 기관사칭 스미싱 대응 훈련을 시작할 수 있습니다.'
      : `판별된 "${mappedType}" 유형과 같은 가상 시나리오로 대응을 연습합니다.`;

  setAnalyzeViewState('result');
}

/**
 * 입력된 텍스트 내용과 일치하는 시연용 고정 예시 결과를 찾습니다.
 * @param {string} inputText 사용자 입력 문자열
 * @returns {object} 백업 판별 결과
 */
function buildBackupAnalyzeResult(inputText) {
  const normalized = (inputText || '').trim();
  if (normalized.includes('입출금') || normalized.includes('입금되었습니다')) {
    return {
      ...BACKUP_ANALYZE_RESULTS.normal,
      extracted_text: normalized || DEMO_SAMPLES.normal.text
    };
  }
  if (normalized.includes('택배') || normalized.includes('배송')) {
    return {
      ...BACKUP_ANALYZE_RESULTS.delivery,
      extracted_text: normalized || DEMO_SAMPLES.delivery.text
    };
  }
  return {
    ...BACKUP_ANALYZE_RESULTS.agency,
    extracted_text: normalized || DEMO_SAMPLES.agency.text
  };
}

/**
 * /api/analyze 엔드포인트를 호출해 문자·이미지 스미싱 위험도를 분석합니다.
 */
async function runAnalyze() {
  const text = el.smsInput.value.trim();
  const imageDataUrl = state.selectedImageDataUrl;

  if (!text && !imageDataUrl) {
    setAnalyzeViewState('error');
    el.analyzeErrorMsg.textContent =
      '분석할 문자 내용을 입력하거나 문자 캡처 이미지를 첨부해 주세요.';
    return;
  }

  state.lastAnalyzePayload = { text, imageDataUrl };

  // 오프라인 시연 모드가 명시적으로 켜져 있으면 즉시 고정 예시 결과 반환
  if (state.demoModeForced) {
    renderAnalyzeResult(buildBackupAnalyzeResult(text), { source: 'demo' });
    return;
  }

  setAnalyzeViewState('loading');
  el.analyzeBtn.disabled = true;

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageDataUrl, easyMode: state.easyMode })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '서버에서 분석 응답을 받지 못했습니다.');
    }

    renderAnalyzeResult(data.result, {
      source: data.source || 'openrouter',
      cached: Boolean(data.cached),
      latencyMs: data.latencyMs
    });
  } catch (error) {
    setAnalyzeViewState('error');
    el.analyzeErrorMsg.textContent =
      error.message || '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    el.analyzeBtn.disabled = false;
  }
}

/**
 * 훈련 시나리오 화면을 렌더링합니다.
 * @param {object} scenario 검증된 시나리오 객체
 * @param {'openrouter'|'demo'} source 출처 표시
 */
function renderTrainingScenario(scenario, source) {
  state.currentScenario = scenario;
  state.currentScenarioSource = source;
  state.scenarioAnswered = false;

  el.trainMetaTag.textContent = `${scenario.scam_type} · ${scenario.difficulty}`;
  el.trainSourceLabel.textContent =
    source === 'demo' ? '시연용 가상 문자 (백업)' : 'AI 생성 교육용 가상 문자';

  // 답변 전에는 힌트를 주지 않도록 하이라이트 없이 본문 표시
  el.trainMessageBox.textContent = scenario.message;

  // 5개 선택지 버튼 렌더링
  el.trainChoices.textContent = '';
  (scenario.choices || []).forEach((choiceLabel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = choiceLabel;
    btn.addEventListener('click', () => handleChoiceSelection(choiceLabel, btn));
    el.trainChoices.appendChild(btn);
  });

  el.trainFeedbackEmpty.classList.remove('hidden');
  el.trainFeedbackResult.classList.add('hidden');
  setTrainViewState('ready');
}

/**
 * 사용자가 대응 선택지를 눌렀을 때 채점하고 해설·신호 하이라이트를 공개합니다.
 * @param {string} chosenLabel 사용자가 고른 선택지
 * @param {HTMLButtonElement} clickedBtn 클릭된 버튼 요소
 */
function handleChoiceSelection(chosenLabel, clickedBtn) {
  if (state.scenarioAnswered || !state.currentScenario) return;
  state.scenarioAnswered = true;

  const scenario = state.currentScenario;
  const bestChoices = Array.isArray(scenario.best_choices) ? scenario.best_choices : [];
  const isCorrect = bestChoices.includes(chosenLabel);

  // 모든 선택지 버튼 비활성화 및 정답·오답 시각 표시
  const allBtns = el.trainChoices.querySelectorAll('.choice-btn');
  allBtns.forEach((btn) => {
    btn.disabled = true;
    if (bestChoices.includes(btn.textContent)) {
      btn.classList.add('is-correct-choice');
    } else if (btn === clickedBtn && !isCorrect) {
      btn.classList.add('is-wrong-choice');
    }
  });

  // 세션 점수 갱신
  const points = isCorrect ? 20 : 0;
  state.sessionStats.total += 1;
  if (isCorrect) {
    state.sessionStats.correct += 1;
    state.sessionStats.score += points;
  }
  renderSessionStats();

  // 가상 문자 본문 속 위험 신호 하이라이트 공개
  renderHighlightedMessage(el.trainMessageBox, scenario.message, scenario.signals);

  // 해설 패널 채우기
  el.trainVerdictBox.classList.remove('verdict-correct', 'verdict-wrong');
  el.trainVerdictBox.classList.add(isCorrect ? 'verdict-correct' : 'verdict-wrong');
  el.trainVerdictTitle.textContent = isCorrect
    ? '적절하고 안전한 대응입니다'
    : '위험할 수 있는 선택입니다';
  el.trainVerdictScore.textContent = isCorrect ? `+${points}점` : '+0점';

  el.trainBestChoices.textContent = bestChoices.join(', ');
  el.trainExplanation.textContent = state.easyMode
    ? scenario.easy_explanation || scenario.explanation
    : scenario.explanation;

  renderSignalsList(el.trainSignalsList, scenario.signals);

  el.trainFeedbackEmpty.classList.add('hidden');
  el.trainFeedbackResult.classList.remove('hidden');
}

/**
 * /api/train 엔드포인트를 호출해 새 교육용 가상 문자를 생성합니다.
 * @param {string} [overrideType] 판별 모드에서 넘어온 사기 유형
 */
async function generateTrainingScenario(overrideType) {
  if (overrideType) {
    el.trainTypeSelect.value = overrideType;
  }

  const scamType = el.trainTypeSelect.value || '기관사칭';
  const difficulty = state.selectedDifficulty || '보통';

  if (state.demoModeForced) {
    const fallback = BACKUP_TRAINING_SCENARIOS[scamType] || BACKUP_TRAINING_SCENARIOS.기관사칭;
    renderTrainingScenario({ ...fallback, difficulty }, 'demo');
    return;
  }

  setTrainViewState('loading');
  el.generateScenarioBtn.disabled = true;

  try {
    const response = await fetch('/api/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scamType, difficulty })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '가상 문자 생성 중 오류가 발생했습니다.');
    }

    renderTrainingScenario(data.scenario, 'openrouter');
  } catch (error) {
    setTrainViewState('error');
    el.trainErrorMsg.textContent =
      error.message || '가상 문자를 불러오지 못했습니다. 다시 시도하거나 시연용 문자를 이용해 주세요.';
  } finally {
    el.generateScenarioBtn.disabled = false;
  }
}

/**
 * 서버 상태(/api/health)를 조회해 OpenRouter API 키 설정 여부를 확인합니다.
 */
async function checkServerHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const data = await res.json();
    state.hasApiKey = Boolean(data?.hasApiKey);

    if (!state.hasApiKey) {
      el.apiStatusBanner.classList.remove('hidden');
      el.apiStatusText.textContent =
        '현재 서버에 OpenRouter API 키가 설정되지 않았습니다. .env.local에 키를 입력하면 실시간 AI 분석이 동작하며, 키 없이도 시연용 고정 예시 모드로 전체 흐름을 체험할 수 있습니다.';
    }
  } catch {
    // 네트워크 체크 실패 시 무시
  }
}

/**
 * 업로드된 이미지 파일을 읽어 미리보기와 DataURL 상태를 설정합니다.
 * @param {File} file 선택된 이미지 파일
 */
function handleImageFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    setAnalyzeViewState('error');
    el.analyzeErrorMsg.textContent = 'PNG, JPG, WEBP 형식의 이미지 파일만 첨부할 수 있습니다.';
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    setAnalyzeViewState('error');
    el.analyzeErrorMsg.textContent = '이미지 파일 크기는 3MB 이하만 업로드할 수 있습니다.';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.selectedImageDataUrl = String(reader.result || '');
    el.imageFileName.textContent = file.name;
    el.imagePreview.src = state.selectedImageDataUrl;
    el.imagePreviewWrap.classList.remove('hidden');
    el.removeImageBtn.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

/**
 * 첨부된 캡처 이미지를 초기화합니다.
 */
function clearSelectedImage() {
  state.selectedImageDataUrl = '';
  el.imageInput.value = '';
  el.imageFileName.textContent = '선택된 이미지 없음';
  el.imagePreview.removeAttribute('src');
  el.imagePreviewWrap.classList.add('hidden');
  el.removeImageBtn.classList.add('hidden');
}

/**
 * 입력 글자 수 카운터를 업데이트합니다.
 */
function updateCharCount() {
  const len = el.smsInput.value.length;
  el.charCount.textContent = `${len.toLocaleString('ko-KR')} / 3,000자`;
}

/**
 * 시연 예시 문자를 입력창에 채웁니다.
 * @param {'agency'|'delivery'|'normal'} sampleKey 샘플 키
 */
function loadSampleText(sampleKey) {
  const sample = DEMO_SAMPLES[sampleKey];
  if (!sample) return;
  switchMode('analyze');
  el.smsInput.value = sample.text;
  updateCharCount();
  el.smsInput.focus();
}

/**
 * 모든 DOM 이벤트 리스너를 초기화합니다.
 */
function bindEvents() {
  // 상단 내비게이션 링크의 모드 자동 전환
  document.querySelectorAll('[data-nav-mode]').forEach((link) => {
    link.addEventListener('click', () => {
      switchMode(link.dataset.navMode);
    });
  });

  // 헤더 주요 CTA 버튼: 기관사칭 시연 예시 불러오기
  el.headerDemoBtn.addEventListener('click', () => {
    loadSampleText('agency');
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });
  });

  // 쉬운 말 안내 토글
  el.easyModeBtn.addEventListener('click', toggleEasyMode);

  // 시연용 고정 예시 모드 전환 배너 버튼
  el.toggleDemoModeBtn.addEventListener('click', () => {
    state.demoModeForced = !state.demoModeForced;
    el.toggleDemoModeBtn.textContent = state.demoModeForced
      ? '실시간 OpenRouter 모드로 복귀'
      : '시연용 고정 예시 모드로 전환';
    el.apiStatusText.textContent = state.demoModeForced
      ? '시연용 고정 예시 모드가 활성화되었습니다. 모든 판별·훈련 흐름을 오프라인 고정 데이터로 체험할 수 있습니다.'
      : '현재 서버에 OpenRouter API 키가 설정되지 않았습니다. .env.local에 키를 입력하면 실시간 AI 분석이 동작하며, 키 없이도 시연용 고정 예시 모드로 전체 흐름을 체험할 수 있습니다.';
  });

  // 모드 탭 전환
  el.tabAnalyze.addEventListener('click', () => switchMode('analyze'));
  el.tabTrain.addEventListener('click', () => switchMode('train'));

  // 빠른 시연 샘플 버튼
  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      loadSampleText(btn.dataset.sample);
    });
  });

  // 텍스트 입력 글자 수 갱신
  el.smsInput.addEventListener('input', updateCharCount);

  // 개인정보 자동 마스킹 버튼
  el.maskPiiBtn.addEventListener('click', () => {
    el.smsInput.value = maskPersonalInfo(el.smsInput.value);
    updateCharCount();
  });

  // 입력 지우기 버튼
  el.clearInputBtn.addEventListener('click', () => {
    el.smsInput.value = '';
    clearSelectedImage();
    updateCharCount();
    setAnalyzeViewState('empty');
  });

  // 이미지 파일 선택 및 제거
  el.imageInput.addEventListener('change', (evt) => {
    const file = evt.target.files?.[0];
    if (file) handleImageFile(file);
  });
  el.removeImageBtn.addEventListener('click', clearSelectedImage);

  // 위험도 분석 실행 및 재시도·백업 버튼
  el.analyzeBtn.addEventListener('click', runAnalyze);
  el.retryAnalyzeBtn.addEventListener('click', runAnalyze);
  el.useDemoAnalyzeBtn.addEventListener('click', () => {
    const text = el.smsInput.value.trim() || DEMO_SAMPLES.agency.text;
    if (!el.smsInput.value.trim()) {
      el.smsInput.value = text;
      updateCharCount();
    }
    renderAnalyzeResult(buildBackupAnalyzeResult(text), { source: 'demo' });
  });

  // 융합 1: 판별 결과 -> 같은 유형 훈련 시작하기
  el.practiceSimilarBtn.addEventListener('click', () => {
    const targetType = el.practiceSimilarBtn.dataset.targetType || '기관사칭';
    switchMode('train');
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    generateTrainingScenario(targetType);
  });

  // 난이도 선택 버튼
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDifficulty = btn.dataset.diff || '보통';
      document.querySelectorAll('.diff-btn').forEach((other) => {
        other.classList.toggle('is-active', other === btn);
      });
    });
  });

  // 새 가상 문자 생성 및 재시도·백업 버튼
  el.generateScenarioBtn.addEventListener('click', () => generateTrainingScenario());
  el.retryTrainBtn.addEventListener('click', () => generateTrainingScenario());
  el.nextScenarioBtn.addEventListener('click', () => generateTrainingScenario());
  el.useDemoTrainBtn.addEventListener('click', () => {
    const scamType = el.trainTypeSelect.value || '기관사칭';
    const fallback = BACKUP_TRAINING_SCENARIOS[scamType] || BACKUP_TRAINING_SCENARIOS.기관사칭;
    renderTrainingScenario({ ...fallback, difficulty: state.selectedDifficulty }, 'demo');
  });

  // 융합 2: 훈련 문자 -> 판별 모드로 보내 하이라이트 복습하기
  el.sendToAnalyzeBtn.addEventListener('click', () => {
    if (!state.currentScenario) return;
    const scenarioMsg = state.currentScenario.message;
    switchMode('analyze');
    el.smsInput.value = scenarioMsg;
    clearSelectedImage();
    updateCharCount();
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    runAnalyze();
  });
}

// 브라우저 환경에서만 초기화 실행 (단위 테스트 임포트 시 DOM 오류 방지)
if (typeof document !== 'undefined') {
  initDomRefs();
  loadSessionStats();
  updateCharCount();
  bindEvents();
  checkServerHealth();
}
