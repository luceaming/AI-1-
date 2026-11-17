/**
 * ClickCheck 프론트엔드 순수 자바스크립트 모듈
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

// 백업용 교육 가상 시나리오 세트 (PRD 5.4 안전 규칙 준수: 5개 유형 × 3개 난이도 총 15종)
export const BACKUP_TRAINING_SCENARIOS = {
  기관사칭: {
    쉬움: {
      scam_type: '기관사칭',
      difficulty: '쉬움',
      message:
        '[○○기관 긴급공지!!] 귀하명의 대포통장 사기연류 의심. 당일 미확인시 즉각 구속수사 진행됩니다!! 지금바로 사건내역조회: https://example.com/arrest-check (문의: 02-000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○기관 긴급공지!!]',
          category: '기관사칭',
          reason: '기관을 사칭하고 과도한 느낌표를 사용해 극심한 불안감을 조성합니다.'
        },
        {
          text: '당일 미확인시 즉각 구속수사 진행됩니다!!',
          category: '긴급성',
          reason: '즉각 구속 등 비상식적이고 극단적인 위협으로 냉정한 판단을 방해합니다.'
        },
        {
          text: 'https://example.com/arrest-check',
          category: 'URL',
          reason: '공공기관은 사건 내역 확인용 사설 URL 링크를 문자로 발송하지 않습니다.'
        }
      ],
      explanation:
        '수사기관이나 공공기관은 문자로 당일 구속을 협박하거나 사건 조회 인터넷 링크를 보내지 않습니다. 링크를 누르거나 적힌 번호로 전화하지 말고 삭제 후 112나 118에 신고하세요.',
      easy_explanation:
        '공공기관은 구속하겠다며 링크를 누르라는 문자를 절대 보내지 않아요. 겁먹지 말고 바로 지우세요.'
    },
    보통: {
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
    어려움: {
      scam_type: '기관사칭',
      difficulty: '어려움',
      message:
        '[○○기관 알림] 전자고지 본인확인 안내: 귀하 앞으로 발송된 전자문서(교통과태료 미납 고지서)가 도착했습니다. 열람 기한 내 확인: https://example.com/edoc/view (문의: 000-0000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○기관 알림]',
          category: '기관사칭',
          reason: '실제 공공 전자고지 알림 발신처처럼 공문서 양식을 매우 사실적으로 모방합니다.'
        },
        {
          text: '전자문서(교통과태료 미납 고지서)',
          category: '개인정보요구',
          reason: '일상적인 행정 고지로 위장해 본인인증 명목의 개인정보·금융정보 입력을 유도합니다.'
        },
        {
          text: 'https://example.com/edoc/view',
          category: 'URL',
          reason: '정부 공식 행정망 도메인이 아닌 외부 피싱 페이지 주소입니다.'
        }
      ],
      explanation:
        '공공기관의 공식 전자문서 알림톡 문체를 완벽히 모방한 신종 스미싱입니다. 오탈자가 없어 속기 쉬우므로 문자 링크 대신 정부24나 경찰청 교통민원24 공식 앱에 직접 접속해 확인해야 합니다.',
      easy_explanation:
        '진짜 관공서 고지서처럼 보이는 정교한 가짜예요. 문자의 주소를 누르지 말고 정부 공식 앱에서 직접 확인하세요.'
    }
  },
  택배: {
    쉬움: {
      scam_type: '택배',
      difficulty: '쉬움',
      message:
        '[○○택배/배송불가!!] 도로명주소 불일치!! 오늘 18시까지 미확인시 물품 전량폐기 됩니다!! 즉시 주소수정: https://example.com/box-fix',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○택배/배송불가!!]',
          category: '기관사칭',
          reason: '택배사를 사칭하며 과도한 느낌표로 불안을 유발합니다.'
        },
        {
          text: '오늘 18시까지 미확인시 물품 전량폐기',
          category: '긴급성',
          reason: '물품 폐기라는 비상식적 불이익을 내세워 성급한 클릭을 유도합니다.'
        },
        {
          text: 'https://example.com/box-fix',
          category: 'URL',
          reason: '택배사는 문자 링크로 주소 수정을 요구하지 않습니다.'
        }
      ],
      explanation:
        '택배사는 주소 불일치를 이유로 당일 전량 폐기 협박을 하거나 문자로 링크 수정을 요구하지 않습니다. 전형적인 피싱 링크이므로 누르지 마세요.',
      easy_explanation:
        '택배를 오늘 바로 버리겠다는 협박 문자는 거짓말이에요. 주소를 누르지 말고 삭제하세요.'
    },
    보통: {
      scam_type: '택배',
      difficulty: '보통',
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
    어려움: {
      scam_type: '택배',
      difficulty: '어려움',
      message:
        '[○○로지스] 고객님의 물품(운송장: 000-0000-0000)이 경비실에 위탁 보관되었습니다. 보관함 비밀번호 및 물품 수령 사진 확인: https://example.com/delivery/photo',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○로지스]',
          category: '기관사칭',
          reason: '실제 택배 배송 완료 안내 문구를 매우 사실적으로 재현했습니다.'
        },
        {
          text: '보관함 비밀번호 및 물품 수령 사진 확인',
          category: '개인정보요구',
          reason: '사진 확인을 미끼로 원격제어 악성 앱(APK) 설치 페이지로 유도합니다.'
        },
        {
          text: 'https://example.com/delivery/photo',
          category: 'URL',
          reason: '정상 배송 링크가 아닌 스마트폰 해킹용 악성 파일 다운로드 주소입니다.'
        }
      ],
      explanation:
        '실제 택배 기사의 배송 완료 사진 알림 문자 형식을 정교하게 사칭한 신종 수법입니다. 링크 접속 시 악성 앱이 설치되어 금융정보가 유출될 수 있으므로, 구매 쇼핑몰 공식 앱에서만 조회하세요.',
      easy_explanation:
        '택배 보관 사진을 보라는 문자 링크도 악성 앱일 수 있어요. 누르지 말고 물건을 주문한 앱에서 확인하세요.'
    }
  },
  지원금: {
    쉬움: {
      scam_type: '지원금',
      difficulty: '쉬움',
      message:
        '[○○지원센터 긴급] 축하합니다!! 2026 정부 특별지원금 300만원 당첨! 선착순 100명 오늘 마감 서둘러 수령하세요: https://example.com/grant-event',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '300만원 당첨!',
          category: '금전요구',
          reason: '정부 지원금은 무작위 당첨 방식으로 지급되지 않습니다.'
        },
        {
          text: '선착순 100명 오늘 마감',
          category: '긴급성',
          reason: '선착순 마감을 내세워 의심할 틈 없이 누르게 만듭니다.'
        },
        {
          text: 'https://example.com/grant-event',
          category: 'URL',
          reason: '사행성 이벤트로 위장한 피싱 사이트 주소입니다.'
        }
      ],
      explanation:
        '정부 재난지원금이나 복지 지원금은 선착순 당첨이나 문자 링크 클릭 방식으로 지급되지 않습니다. 개인정보 탈취를 노리는 전형적 미끼입니다.',
      easy_explanation:
        '지원금에 당첨되었다는 문자는 가짜예요. 링크를 누르면 금융정보가 빠져나가니 지우세요.'
    },
    보통: {
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
    어려움: {
      scam_type: '지원금',
      difficulty: '어려움',
      message:
        '[○○재단] 2026 소상공인 정책자금 1차 적격 심사 결과 안내. 귀하는 특별 지원금 지급 대상자로 예비 선정되었습니다. 지원금 지급 조건 및 심사 결과 확인: https://example.com/policy/grant (문의: 000-0000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○재단]',
          category: '기관사칭',
          reason: '공식 정책금융 기관이나 공익재단의 공문서 양식을 자연스럽게 사칭합니다.'
        },
        {
          text: '예비 선정되었습니다',
          category: '개인정보요구',
          reason: '선정 사실을 미끼로 본인확인용 공인인증서나 계좌비밀번호 입력을 유도합니다.'
        },
        {
          text: 'https://example.com/policy/grant',
          category: 'URL',
          reason: '공식 정책자금 접수 시스템을 위장한 정교한 피싱 페이지입니다.'
        }
      ],
      explanation:
        '공공기관의 정책금융 지원 사업 공고를 정교하게 흉내 낸 수법입니다. 공식 기관은 문자 링크를 통해 지원금 대상자 심사 결과를 확인하도록 요구하지 않으므로 소상공인진흥공단 등 대표 사이트에서 직접 조회해야 합니다.',
      easy_explanation:
        '심사에 통과했다며 온 지원금 문자도 가짜일 수 있어요. 주소를 누르지 말고 해당 기관 대표번호로 직접 문의하세요.'
    }
  },
  지인사칭: {
    쉬움: {
      scam_type: '지인사칭',
      difficulty: '쉬움',
      message:
        '엄마 나 지금 폰 고장나서 PC방인데 편의점 가서 구글 기프트카드 50만원권 사서 핀번호 사진좀 찍어보내줘 급해!! https://example.com/pin (연락처: 000-0000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['가족에게 확인하기', '신고하기', '삭제하기'],
      signals: [
        {
          text: '구글 기프트카드 50만원권',
          category: '금전요구',
          reason: '자녀를 사칭하여 추적이 어려운 상품권 핀번호를 요구하는 전형적 수법입니다.'
        },
        {
          text: '핀번호 사진좀 찍어보내줘 급해!!',
          category: '긴급성',
          reason: '급박한 상황을 연출해 본인 확인을 거치지 못하게 독촉합니다.'
        },
        {
          text: 'https://example.com/pin',
          category: 'URL',
          reason: '상품권 핀번호를 즉시 탈취하려는 사기 페이지입니다.'
        }
      ],
      explanation:
        '자녀나 지인을 사칭하여 편의점 기프트카드나 상품권 핀번호를 요구하는 전형적 메신저 피싱 수법입니다. 문자에 답장하거나 링크를 누르지 말고, 기존에 알던 자녀 전화번호로 직접 음성 통화해 확인해야 합니다.',
      easy_explanation:
        '가족이라면서 상품권이나 핀번호를 사달라는 문자는 사기예요. 원래 알던 번호로 직접 전화해서 물어보세요.'
    },
    보통: {
      scam_type: '지인사칭',
      difficulty: '보통',
      message:
        '엄마 나 핸드폰 액정 깨져서 수리 맡겼어. 지금 급하게 결제할 게 있는데 000-0000-0000(○○은행) 계좌로 50만 원만 먼저 보내줄 수 있어?',
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
    어려움: {
      scam_type: '지인사칭',
      difficulty: '어려움',
      message:
        '[모바일청첩장] 저희 두 사람의 새로운 시작을 축복해 주세요. 일시: 다음 달 18일 토요일 13시. 모바일 청첩장 보기 및 식장 안내: https://example.com/wedding/invite',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['가족에게 확인하기', '신고하기', '삭제하기'],
      signals: [
        {
          text: '[모바일청첩장]',
          category: '기관사칭',
          reason: '일상적인 경조사 알림으로 위장해 경계심을 완전히 무너뜨립니다.'
        },
        {
          text: '모바일 청첩장 보기 및 식장 안내',
          category: '개인정보요구',
          reason: '청첩장 열람을 미끼로 스마트폰에 악성 파일(APK) 설치를 유도합니다.'
        },
        {
          text: 'https://example.com/wedding/invite',
          category: 'URL',
          reason: '스마트폰 내 주소록과 공인인증서를 빼가는 악성 앱 유포 도메인입니다.'
        }
      ],
      explanation:
        '실제 지인의 청첩장이나 부고장 문자와 구별하기 어려운 최신 고난도 스미싱입니다. 링크를 누르는 순간 스마트폰에 악성코드가 깔리고 지인들에게 동일 문자가 대량 발송되므로, 링크를 누르지 말고 당사자에게 전화로 사실 여부를 확인해야 합니다.',
      easy_explanation:
        '청첩장 속 인터넷 주소를 누르면 핸드폰에 해킹 프로그램이 깔릴 수 있어요. 절대 주소를 누르지 말고 지인에게 전화해 보세요.'
    }
  },
  대출: {
    쉬움: {
      scam_type: '대출',
      difficulty: '쉬움',
      message:
        '[○○금융 긴급대출] 신용불량/연체자 누구나 무심사 당일 1억원 즉시대출 승인!! 최저금리 1.2% 오늘 마감 즉시대출신청: https://example.com/fast-loan (문의: 000-0000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '무심사 당일 1억원 즉시대출 승인!!',
          category: '금전요구',
          reason: '심사 없이 파격적 조건으로 대출해 준다는 비현실적인 미끼입니다.'
        },
        {
          text: '오늘 마감',
          category: '긴급성',
          reason: '당일 마감을 강조해 정상적인 금융 상품인지 비교할 여유를 주지 않습니다.'
        },
        {
          text: 'https://example.com/fast-loan',
          category: 'URL',
          reason: '선입금 수수료 요구 및 금융사기를 위한 피싱 링크입니다.'
        }
      ],
      explanation:
        '정식 금융회사는 신용 조회나 심사도 없이 신용불량자에게 당일 수억 원을 저금리로 대출해 주지 않습니다. 전형적인 대출 사기 미끼입니다.',
      easy_explanation:
        '신용조사도 없이 큰돈을 쉽게 빌려준다는 문자는 사기예요. 주소를 절대 누르지 마세요.'
    },
    보통: {
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
    },
    어려움: {
      scam_type: '대출',
      difficulty: '어려움',
      message:
        '[○○은행] 고객님의 신용대출 만기 도래에 따른 금리인하요구권 심사 신청 안내. 비대면 간편 심사를 통해 최대 1.5% 우대금리가 적용됩니다. 심사 서류 확인: https://example.com/loan/renew (문의: 000-0000-0000)',
      choices: ['신고하기', '삭제하기', '링크 누르기', '적힌 번호로 전화하기', '가족에게 확인하기'],
      best_choices: ['신고하기', '삭제하기'],
      signals: [
        {
          text: '[○○은행]',
          category: '기관사칭',
          reason: '기존 대출 보유 고객을 겨냥해 실제 1금융권 만기 연장 안내 형식을 사실적으로 사칭합니다.'
        },
        {
          text: '심사 서류 확인',
          category: '개인정보요구',
          reason: '대출 서류 열람을 빙자해 보안카드 일련번호와 금융인증서 비밀번호를 가로챕니다.'
        },
        {
          text: 'https://example.com/loan/renew',
          category: 'URL',
          reason: '정상 금융 포털이 아닌 가짜 모바일 뱅킹 피싱 사이트입니다.'
        }
      ],
      explanation:
        '기존 은행의 정상적인 만기 도래 및 금리인하 신청 안내 문자를 거의 그대로 흉내 낸 최신 수법입니다. 문자의 링크로 접속하지 말고, 은행 공식 모바일 뱅킹 앱을 직접 실행해 본인의 대출 관리 메뉴에서 확인해야 합니다.',
      easy_explanation:
        '대출 금리를 낮춰주겠다는 문자도 가짜일 수 있어요. 문자의 주소를 누르지 말고 은행 공식 앱에서 직접 확인하세요.'
    }
  }
};

// 하위 호환성 보장: BACKUP_TRAINING_SCENARIOS[scamType] 자체를 직접 읽는 기존 코드와 완벽 호환
Object.keys(BACKUP_TRAINING_SCENARIOS).forEach((type) => {
  const byType = BACKUP_TRAINING_SCENARIOS[type];
  if (byType && byType.보통) {
    Object.assign(byType, byType.보통);
  }
});

/**
 * 사기 유형과 난이도에 맞는 시연용 백업 시나리오를 반환합니다.
 * @param {string} scamType 사기 유형 ('기관사칭'|'택배'|'지원금'|'지인사칭'|'대출')
 * @param {string} difficulty 난이도 ('쉬움'|'보통'|'어려움')
 * @returns {object} 정규화된 훈련 시나리오 객체 복사본
 */
export function getBackupScenario(scamType, difficulty) {
  const typeKey = BACKUP_TRAINING_SCENARIOS[scamType] ? scamType : '기관사칭';
  const diffKey = ['쉬움', '보통', '어려움'].includes(difficulty) ? difficulty : '보통';
  const typeGroup = BACKUP_TRAINING_SCENARIOS[typeKey];
  const target = typeGroup?.[diffKey] || typeGroup?.보통 || BACKUP_TRAINING_SCENARIOS.기관사칭.보통;
  return JSON.parse(JSON.stringify(target));
}

// 애플리케이션 상태 관리 객체
export const state = {
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
  },
  currentSignalModalSample: null,
  currentSignalModalId: '01',
  currentSignalModalName: '긴급성 압박'
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
    resetStatsBtn: document.getElementById('btn-reset-stats'),

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
    chkSaveKb: document.getElementById('chk-save-kb'),
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
    resHighlightCaption: document.getElementById('res-highlight-caption'),
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
    nextScenarioBtn: document.getElementById('btn-next-scenario'),

    signalModal: document.getElementById('signal-sample-modal'),
    signalModalBadge: document.getElementById('signal-modal-badge'),
    signalModalTitle: document.getElementById('signal-modal-title'),
    signalModalLoading: document.getElementById('signal-modal-loading'),
    signalModalError: document.getElementById('signal-modal-error'),
    signalModalErrorMsg: document.getElementById('signal-modal-error-msg'),
    signalModalContent: document.getElementById('signal-modal-content'),
    signalSampleImg: document.getElementById('signal-sample-img'),
    signalModalHighlight: document.getElementById('signal-modal-highlight'),
    signalModalExplanation: document.getElementById('signal-modal-explanation'),
    signalModalCountermeasure: document.getElementById('signal-modal-countermeasure'),
    closeSignalModalBtn: document.getElementById('btn-close-signal-modal'),
    closeSignalModalBottomBtn: document.getElementById('btn-close-signal-modal-bottom'),
    downloadSignalImgBtn: document.getElementById('btn-download-signal-img'),
    regenSignalSampleBtn: document.getElementById('btn-regen-signal-sample'),

    kbTotalCount: document.getElementById('kb-total-count'),
    kbImageCount: document.getElementById('kb-image-count'),
    kbTypeFilter: document.getElementById('kb-type-filter'),
    refreshKbBtn: document.getElementById('btn-refresh-kb'),
    kbSetupGuide: document.getElementById('kb-setup-guide'),
    kbEmptyMsg: document.getElementById('kb-empty-msg'),
    kbCasesGrid: document.getElementById('kb-cases-grid')
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
    const saved = sessionStorage.getItem('clickcheck_session_stats');
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
  if (el?.statScore) {
    el.statScore.textContent = String(score);
  }
  if (el?.statCount) {
    el.statCount.textContent = String(total);
  }
  if (el?.statAccuracy) {
    el.statAccuracy.textContent = total > 0 ? `${Math.round((correct / total) * 100)}%` : '—';
  }

  try {
    sessionStorage.setItem('clickcheck_session_stats', JSON.stringify(state.sessionStats));
  } catch {
    // 무시
  }
}

/**
 * 누적 점수, 정답률, 완료 수를 0으로 초기화하고 UI 및 스토리지를 갱신합니다.
 */
export function resetSessionStats() {
  state.sessionStats = {
    score: 0,
    total: 0,
    correct: 0
  };
  try {
    sessionStorage.removeItem('clickcheck_session_stats');
  } catch {
    // 무시
  }
  renderSessionStats();

  if (el?.resetStatsBtn) {
    el.resetStatsBtn.classList.remove('is-spinning');
    void el.resetStatsBtn.offsetWidth;
    el.resetStatsBtn.classList.add('is-spinning');
    setTimeout(() => {
      el.resetStatsBtn?.classList.remove('is-spinning');
    }, 450);
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
  } else if (meta?.source === 'supabase_cache') {
    sourceParts.push('Supabase 누적 사례 캐시');
  } else {
    sourceParts.push('OpenRouter 실시간 분석');
    if (meta?.cached) sourceParts.push('캐시 응답');
    if (meta?.rag?.usedCount > 0) {
      sourceParts.push(`과거 유사 사례 ${meta.rag.usedCount}건 참고`);
    }
    if (meta?.knowledgeBase?.saved) {
      sourceParts.push('비식별 DB 저장');
    }
    if (typeof meta?.latencyMs === 'number' && meta.latencyMs > 0) {
      sourceParts.push(`${(meta.latencyMs / 1000).toFixed(1)}초`);
    }
  }
  el.resSourceLabel.textContent = sourceParts.join(' · ');

  el.resSummary.textContent = state.easyMode
    ? result.easy_summary || result.summary
    : result.summary;

  if (el.resHighlightCaption) {
    el.resHighlightCaption.textContent =
      meta?.inputType === 'image' || meta?.inputType === 'mixed'
        ? '캡처 이미지에서 AI가 추출한 텍스트입니다 · 하이라이트 문구를 누르면 아래 설명으로 이동합니다'
        : '하이라이트 문구를 누르면 아래 설명으로 이동합니다';
  }

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
 * 서버 응답 본문을 안전하게 JSON으로 파싱합니다.
 * Vercel 게이트웨이 오류(413, 502, 504 등)로 HTML/텍스트가 반환돼도 SyntaxError 대신 명확한 안내를 제공합니다.
 * @param {Response} response fetch 응답 객체
 * @returns {Promise<object>} 파싱된 JSON 객체
 */
async function safeParseResponseJson(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) {
    return {
      ok: false,
      message:
        response.status === 413
          ? '첨부 이미지 용량이 서버 허용 한도를 초과했습니다. 더 작은 이미지를 선택해 주세요.'
          : response.status === 504
            ? 'AI 분석 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
            : `서버 응답이 비어 있습니다(${response.status}).`
    };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message:
        response.status === 413
          ? '첨부 이미지 용량이 너무 큽니다. 이미지 크기를 줄여 다시 시도해 주세요.'
          : response.status === 504
            ? '서버 처리 시간이 초과되었습니다(504). 잠시 후 다시 시도해 주세요.'
            : `서버 응답을 해석할 수 없습니다(${response.status}).`
    };
  }
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
    const saveToKnowledgeBase = el.chkSaveKb ? Boolean(el.chkSaveKb.checked) : true;
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        imageDataUrl,
        easyMode: state.easyMode,
        saveToKnowledgeBase
      })
    });

    const data = await safeParseResponseJson(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '서버에서 분석 응답을 받지 못했습니다.');
    }

    renderAnalyzeResult(data.result, {
      source: data.source || 'openrouter',
      cached: Boolean(data.cached),
      latencyMs: data.latencyMs,
      inputType: data.inputType,
      rag: data.rag,
      knowledgeBase: data.knowledgeBase
    });

    // 새 사례가 Supabase에 저장되었으면 하단 누적 사례 목록 갱신
    if (data.knowledgeBase?.saved) {
      loadKnowledgeCases();
    }
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
 * @param {number} [ragUsedCount=0] 참고한 Supabase 누적 사례 수
 */
function renderTrainingScenario(scenario, source, ragUsedCount = 0) {
  state.currentScenario = scenario;
  state.currentScenarioSource = source;
  state.scenarioAnswered = false;

  el.trainMetaTag.textContent = `${scenario.scam_type} · ${scenario.difficulty}`;
  if (source === 'demo') {
    el.trainSourceLabel.textContent = '시연용 가상 문자 (백업)';
  } else if (ragUsedCount > 0) {
    el.trainSourceLabel.textContent = `AI 생성 교육용 가상 문자 · 누적 사례 ${ragUsedCount}건 반영`;
  } else {
    el.trainSourceLabel.textContent = 'AI 생성 교육용 가상 문자';
  }

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
    const scenario = getBackupScenario(scamType, difficulty);
    renderTrainingScenario(scenario, 'demo');
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

    const data = await safeParseResponseJson(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '가상 문자 생성 중 오류가 발생했습니다.');
    }

    renderTrainingScenario(data.scenario, 'openrouter', Number(data.ragUsedCount || 0));
  } catch (error) {
    setTrainViewState('error');
    el.trainErrorMsg.textContent =
      error.message || '가상 문자를 불러오지 못했습니다. 다시 시도하거나 시연용 문자를 이용해 주세요.';
  } finally {
    el.generateScenarioBtn.disabled = false;
  }
}

/**
 * 서버 상태(/api/health)를 조회해 OpenRouter API 키 및 Supabase 설정 여부를 확인합니다.
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
 * 사례의 입력 방식('text'|'image'|'mixed')을 사용자 친화적인 한국어 라벨로 변환합니다.
 * @param {string} inputType 입력 유형
 * @returns {string} 한국어 라벨
 */
export function formatCaseInputTypeLabel(inputType) {
  if (inputType === 'image') return '캡처 이미지 변환';
  if (inputType === 'mixed') return '텍스트+이미지 변환';
  return '텍스트 입력';
}

/**
 * 긴 비식별 사례 본문을 카드 표시용으로 안전하게 축약합니다.
 * @param {string} text 비식별 텍스트
 * @param {number} [maxLen=110] 최대 길이
 * @returns {string} 축약 문자열
 */
export function buildCaseExcerpt(text, maxLen = 110) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen).trim()}…`;
}

/**
 * Supabase 누적 사례 목록(/api/cases)을 조회해 라이브러리 섹션을 갱신합니다.
 */
async function loadKnowledgeCases() {
  if (!el?.kbCasesGrid) return;

  try {
    const scamType = el.kbTypeFilter ? el.kbTypeFilter.value : '';
    const params = new URLSearchParams({ limit: '6' });
    if (scamType) params.set('scamType', scamType);

    const res = await fetch(`/api/cases?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.ok) return;

    if (el.kbTotalCount) el.kbTotalCount.textContent = String(data.totalCount || 0);
    if (el.kbImageCount) el.kbImageCount.textContent = String(data.imageConvertedCount || 0);

    if (!data.configured) {
      el.kbSetupGuide?.classList.remove('hidden');
      el.kbEmptyMsg?.classList.add('hidden');
      el.kbCasesGrid.textContent = '';
      return;
    }

    el.kbSetupGuide?.classList.add('hidden');

    const cases = Array.isArray(data.cases) ? data.cases : [];
    el.kbCasesGrid.textContent = '';

    if (data.queryError) {
      el.kbEmptyMsg?.classList.remove('hidden');
      const desc = el.kbEmptyMsg?.querySelector('.state-desc');
      if (desc) {
        desc.textContent =
          `Supabase 연결 중 확인이 필요합니다(${data.queryError}). Supabase SQL Editor에서 schema.sql 실행 여부와 서버 환경 변수(URL·서비스 역할 키) 설정을 확인해 주세요.`;
      }
      return;
    }

    if (cases.length === 0) {
      el.kbEmptyMsg?.classList.remove('hidden');
      const desc = el.kbEmptyMsg?.querySelector('.state-desc');
      if (desc) {
        desc.textContent =
          '아직 조건에 맞는 저장 사례가 없습니다. 위 판별 모드에서 문자나 캡처 이미지를 분석하면 비식별 텍스트가 자동으로 축적됩니다.';
      }
      return;
    }

    el.kbEmptyMsg?.classList.add('hidden');

    cases.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'kb-case-card';

      const top = document.createElement('div');
      top.className = 'kb-case-top';

      const badges = document.createElement('div');
      badges.className = 'kb-case-badges';

      const riskBadge = document.createElement('span');
      const riskLevel = item.risk_level || '주의';
      riskBadge.className = `kb-risk-tag ${
        riskLevel === '위험'
          ? 'kb-risk-danger'
          : riskLevel === '안전'
            ? 'kb-risk-safe'
            : 'kb-risk-caution'
      }`;
      riskBadge.textContent = `${riskLevel} ${item.risk_score ?? 50}점`;

      const typeLabel = document.createElement('span');
      typeLabel.className = 'kb-type-label';
      typeLabel.textContent = item.scam_type || '기타';

      badges.appendChild(riskBadge);
      badges.appendChild(typeLabel);

      const srcLabel = document.createElement('span');
      srcLabel.className = 'kb-source-label';
      srcLabel.textContent = formatCaseInputTypeLabel(item.input_type);

      top.appendChild(badges);
      top.appendChild(srcLabel);

      const textBox = document.createElement('p');
      textBox.className = 'kb-case-text';
      textBox.textContent = buildCaseExcerpt(item.masked_text, 120);

      const summary = document.createElement('p');
      summary.className = 'kb-case-summary';
      summary.textContent = buildCaseExcerpt(item.summary, 90);

      const footer = document.createElement('div');
      footer.className = 'kb-case-footer';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'kb-case-date';
      dateSpan.textContent = item.created_at
        ? new Date(item.created_at).toLocaleDateString('ko-KR')
        : '';

      const reuseBtn = document.createElement('button');
      reuseBtn.type = 'button';
      reuseBtn.className = 'btn btn-ghost btn-sm';
      reuseBtn.textContent = '이 사례 불러오기';
      reuseBtn.addEventListener('click', () => {
        switchMode('analyze');
        el.smsInput.value = item.masked_text || '';
        clearSelectedImage();
        updateCharCount();
        document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.smsInput.focus();
      });

      footer.appendChild(dateSpan);
      footer.appendChild(reuseBtn);

      card.appendChild(top);
      card.appendChild(textBox);
      if (item.summary) card.appendChild(summary);
      card.appendChild(footer);
      el.kbCasesGrid.appendChild(card);
    });
  } catch {
    // 목록 조회 실패 시 UI 깨짐 없이 무시
  }
}

/**
 * Vercel 서버리스 요청 크기 제한(4.5MB)을 넘기지 않도록 대용량 캡처 이미지를 브라우저에서 안전하게 축소합니다.
 * @param {string} dataUrl 원본 이미지 Data URL
 * @returns {Promise<string>} 최적화된 Data URL
 */
function compressImageDataUrlIfNeeded(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || dataUrl.length < 1_600_000 || typeof Image === 'undefined') {
      resolve(dataUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 800) * scale));
        const height = Math.max(1, Math.round((img.height || 800) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.86);
        resolve(compressed && compressed.length < dataUrl.length ? compressed : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
  reader.onload = async () => {
    const rawDataUrl = String(reader.result || '');
    state.selectedImageDataUrl = await compressImageDataUrlIfNeeded(rawDataUrl);
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

// 6대 위험 신호 클라이언트 백업 시나리오 세트 (오프라인/대체용)
export const CLIENT_SIGNAL_SAMPLES = {
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
 */
function wrapSvgLines(text, maxChars = 21) {
  if (!text) return [];
  const lines = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }
    let sliceEnd = maxChars;
    const spaceIndex = remaining.lastIndexOf(' ', maxChars);
    if (spaceIndex > maxChars * 0.45) {
      sliceEnd = spaceIndex;
    }
    lines.push(remaining.slice(0, sliceEnd).trim());
    remaining = remaining.slice(sliceEnd).trim();
  }
  return lines;
}

/**
 * XML 특수문자 이스케이프
 */
function escapeXmlText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 스마트폰 문자 수신 캡처 형태의 정교한 SVG 이미지를 생성합니다.
 * @param {object} sample 위험 신호 샘플 객체
 * @returns {string} SVG XML 문자열
 */
export function buildSignalSampleSvg(sample) {
  const signalId = escapeXmlText(sample.signalId || '01');
  const signalName = escapeXmlText(sample.signalName || '위험 신호');
  const sender = escapeXmlText(sample.sender || '000-0000-0000 (가상 번호)');
  const receivedAt = escapeXmlText(sample.receivedAt || '오늘 오후 2:15');
  const message = sample.message || '';
  const highlightPhrase = sample.highlightPhrase || '';
  const threatType = escapeXmlText(sample.threatType || '스미싱 의심 표현');

  const messageLines = wrapSvgLines(message, 21);
  const bubbleHeight = Math.max(130, 48 + messageLines.length * 20 + 20);

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 560" width="380" height="560">
  <defs>
    <filter id="phoneShadowClient" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.18" />
    </filter>
    <linearGradient id="bubbleGradClient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f8fafc" />
    </linearGradient>
  </defs>

  <rect x="8" y="8" width="364" height="544" rx="36" fill="#0f172a" stroke="#334155" stroke-width="2.5" filter="url(#phoneShadowClient)" />
  <rect x="18" y="18" width="344" height="524" rx="28" fill="#f1f5f9" />
  <rect x="135" y="24" width="110" height="18" rx="9" fill="#020617" />
  <circle cx="230" cy="33" r="3.5" fill="#1e293b" />

  <text x="42" y="37" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#0f172a">14:15</text>
  <path d="M 314 30 L 324 30 L 324 37 L 314 37 Z" fill="#0f172a" rx="1.5" />
  <rect x="325" y="32" width="2" height="3" rx="1" fill="#0f172a" />
  <path d="M 302 36 A 6 6 0 0 1 308 30 M 304 36 A 3 3 0 0 1 307 33" stroke="#0f172a" stroke-width="1.5" fill="none" stroke-linecap="round" />

  <rect x="18" y="48" width="344" height="52" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
  <path d="M 36 74 L 43 67 M 36 74 L 43 81" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="68" cy="74" r="15" fill="#e0e7ff" />
  <path d="M 64 74 A 4 4 0 0 1 72 74 A 4 4 0 0 1 64 74 Z M 62 82 A 6 6 0 0 1 74 82" stroke="#4338ca" stroke-width="1.6" fill="none" />
  
  <text x="92" y="69" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${sender}</text>
  <text x="92" y="84" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="10.5" fill="#64748b">문자메시지 · 가상 번호</text>

  <g transform="translate(30, 112)">
    <rect x="0" y="0" width="320" height="28" rx="6" fill="#fef2f2" stroke="#fecaca" stroke-width="1" />
    <circle cx="16" cy="14" r="6" fill="#ef4444" />
    <text x="16" y="17.5" font-family="-apple-system, sans-serif" font-size="9" font-weight="900" fill="#ffffff" text-anchor="middle">!</text>
    <text x="28" y="18" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="#b91c1c">신호 ${signalId} 탐지: ${signalName}</text>
  </g>

  <text x="190" y="156" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10.5" fill="#94a3b8">${receivedAt}</text>

  <g transform="translate(30, 166)">
    <rect x="0" y="0" width="320" height="${bubbleHeight}" rx="14" fill="url(#bubbleGradClient)" stroke="#cbd5e1" stroke-width="1.2" />
    <text x="16" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif" font-size="12" fill="#1e293b">`;

  messageLines.forEach((line, idx) => {
    const isHighlightLine = highlightPhrase && line.includes(highlightPhrase.slice(0, 8));
    if (isHighlightLine) {
      svg += `\n      <tspan x="16" dy="${idx === 0 ? 0 : 20}" font-weight="700" fill="#dc2626">${escapeXmlText(line)}</tspan>`;
    } else {
      svg += `\n      <tspan x="16" dy="${idx === 0 ? 0 : 20}">${escapeXmlText(line)}</tspan>`;
    }
  });

  svg += `
    </text>
  </g>

  <g transform="translate(30, ${176 + bubbleHeight})">
    <rect x="0" y="0" width="320" height="66" rx="8" fill="#fff1f2" stroke="#fda4af" stroke-width="1.2" />
    <text x="12" y="20" font-family="-apple-system, sans-serif" font-size="10.5" font-weight="800" fill="#be123c">위험 신호 핵심 분석</text>
    <text x="12" y="37" font-family="-apple-system, sans-serif" font-size="10.5" font-weight="600" fill="#881337">수법: ${threatType}</text>
    <text x="12" y="53" font-family="-apple-system, sans-serif" font-size="9.5" fill="#9f1239">핵심 구문: "${escapeXmlText(highlightPhrase.slice(0, 22))}${highlightPhrase.length > 22 ? '...' : ''}"</text>
  </g>

  <g transform="translate(30, 484)">
    <rect x="0" y="0" width="320" height="32" rx="6" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1" />
    <text x="160" y="20" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" fill="#1e40af">
      ClickCheck AI 안전 교육용 가상 이미지 (Gemma 4)
    </text>
  </g>

  <rect x="140" y="524" width="100" height="4" rx="2" fill="#94a3b8" />
</svg>`;

  return svg;
}

/**
 * 6대 위험 신호 모달 팝업을 열고, google/gemma-4-26b-a4b-it:free 모델 기반 가상 예시 이미지를 불러와 표시합니다.
 * @param {string} signalId 위험 신호 번호 ('01' ~ '06')
 * @param {string} signalName 위험 신호 이름 ('긴급성 압박' 등)
 */
export async function openSignalSampleModal(signalId, signalName) {
  if (!el?.signalModal) return;

  state.currentSignalModalId = signalId || '01';
  state.currentSignalModalName = signalName || '긴급성 압박';

  // 모달 헤더 초기화
  el.signalModalBadge.textContent = `위험 신호 ${state.currentSignalModalId}`;
  el.signalModalTitle.textContent = `${state.currentSignalModalId}. ${state.currentSignalModalName} 가상 예시 이미지`;

  // 상태 전환: 로딩 뷰 표시
  el.signalModalLoading.classList.remove('hidden');
  el.signalModalContent.classList.add('hidden');
  el.signalModalError.classList.add('hidden');
  el.signalModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const fallback =
    CLIENT_SIGNAL_SAMPLES[state.currentSignalModalId] ||
    CLIENT_SIGNAL_SAMPLES['01'];

  try {
    const res = await fetch('/api/signal-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signalId: state.currentSignalModalId,
        signalName: state.currentSignalModalName
      })
    });

    const data = await safeParseResponseJson(res);
    if (!res.ok || !data.ok || !data.sample) {
      throw new Error(data?.message || '예시 이미지 생성 실패');
    }

    renderSignalSampleModal(data.sample);
  } catch (error) {
    // 네트워크 실패 또는 서버리스 미지원 환경 시 로컬 폴백 SVG 즉시 렌더링
    const svg = buildSignalSampleSvg(fallback);
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    renderSignalSampleModal({
      ...fallback,
      svg,
      imageUrl
    });
  }
}

/**
 * 모달 콘텐츠에 위험 신호 샘플 데이터를 렌더링합니다.
 * @param {object} sample 
 */
function renderSignalSampleModal(sample) {
  state.currentSignalModalSample = sample;

  el.signalSampleImg.src = sample.imageUrl;
  el.signalModalHighlight.textContent = `"${sample.highlightPhrase || ''}"`;
  el.signalModalExplanation.textContent = sample.explanation || '';
  el.signalModalCountermeasure.textContent = sample.countermeasure || '';

  el.signalModalLoading.classList.add('hidden');
  el.signalModalContent.classList.remove('hidden');
}

/**
 * 위험 신호 모달 팝업을 닫습니다.
 */
export function closeSignalSampleModal() {
  if (!el?.signalModal) return;
  el.signalModal.classList.add('hidden');
  document.body.style.overflow = '';
}

/**
 * 현재 모달에 렌더링된 SVG 가상 예시 이미지를 파일(.svg)로 다운로드합니다.
 */
export function downloadSignalSampleSvg() {
  const sample = state.currentSignalModalSample;
  if (!sample?.svg) return;

  const blob = new Blob([sample.svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `스미싱_위험신호_${sample.signalId || '01'}_${sample.signalName || '예시'}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  // 세션 누적 훈련 기록 초기화 버튼
  el.resetStatsBtn?.addEventListener('click', resetSessionStats);

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

  // 사기 유형 변경 시 이미 시연 가상 문자를 보고 있다면 해당 유형과 선택된 난이도로 즉시 갱신
  el.trainTypeSelect.addEventListener('change', () => {
    if (
      state.activeMode === 'train' &&
      state.currentScenarioSource === 'demo' &&
      state.currentScenario
    ) {
      const scamType = el.trainTypeSelect.value || '기관사칭';
      const scenario = getBackupScenario(scamType, state.selectedDifficulty);
      renderTrainingScenario(scenario, 'demo');
    }
  });

  // 난이도 선택 버튼
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prevDiff = state.selectedDifficulty;
      const newDiff = btn.dataset.diff || '보통';
      state.selectedDifficulty = newDiff;

      document.querySelectorAll('.diff-btn').forEach((other) => {
        other.classList.toggle('is-active', other === btn);
      });

      // 시연용 가상 문자(demo)를 보고 있는 상태에서 난이도를 조절했을 때
      // 해당 난이도에 맞는 새로운 시연 문자로 즉시 교체 렌더링
      if (
        state.activeMode === 'train' &&
        state.currentScenarioSource === 'demo' &&
        state.currentScenario &&
        prevDiff !== newDiff
      ) {
        const scamType = el.trainTypeSelect.value || state.currentScenario.scam_type || '기관사칭';
        const scenario = getBackupScenario(scamType, newDiff);
        renderTrainingScenario(scenario, 'demo');
      }
    });
  });

  // 새 가상 문자 생성 및 재시도·백업 버튼
  el.generateScenarioBtn.addEventListener('click', () => generateTrainingScenario());
  el.retryTrainBtn.addEventListener('click', () => generateTrainingScenario());
  el.nextScenarioBtn.addEventListener('click', () => {
    // 시연 가상 문자 체험 중이고 API 키가 없거나 고정 시연 모드인 경우
    // 바로 다음 난이도로 순환하며 시연 문자를 연속 체험할 수 있도록 지원
    if (state.currentScenarioSource === 'demo' && (!state.hasApiKey || state.demoModeForced)) {
      const scamType = el.trainTypeSelect.value || '기관사칭';
      const diffOrder = ['쉬움', '보통', '어려움'];
      const currentIdx = diffOrder.indexOf(state.selectedDifficulty);
      const nextDiff = diffOrder[(currentIdx + 1) % diffOrder.length];
      state.selectedDifficulty = nextDiff;
      document.querySelectorAll('.diff-btn').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.diff === nextDiff);
      });
      const scenario = getBackupScenario(scamType, nextDiff);
      renderTrainingScenario(scenario, 'demo');
      return;
    }
    generateTrainingScenario();
  });
  el.useDemoTrainBtn.addEventListener('click', () => {
    const scamType = el.trainTypeSelect.value || '기관사칭';
    const scenario = getBackupScenario(scamType, state.selectedDifficulty);
    renderTrainingScenario(scenario, 'demo');
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

  // 6대 위험 신호 카드 클릭 시 모달 열기 (google/gemma-4-26b-a4b-it:free 활용)
  document.querySelectorAll('.guide-clickable').forEach((card) => {
    const handleOpen = () => {
      const signalId = card.dataset.signalId || '01';
      const signalName = card.dataset.signalName || '긴급성 압박';
      openSignalSampleModal(signalId, signalName);
    };

    card.addEventListener('click', handleOpen);
    card.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        handleOpen();
      }
    });
  });

  // 모달 닫기 버튼들
  el.closeSignalModalBtn?.addEventListener('click', closeSignalSampleModal);
  el.closeSignalModalBottomBtn?.addEventListener('click', closeSignalSampleModal);

  // 모달 백드롭 클릭 시 닫기
  el.signalModal?.addEventListener('click', (evt) => {
    if (evt.target === el.signalModal) {
      closeSignalSampleModal();
    }
  });

  // ESC 키 누를 때 모달 닫기
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && el.signalModal && !el.signalModal.classList.contains('hidden')) {
      closeSignalSampleModal();
    }
  });

  // 모달 내 이미지 다운로드 버튼
  el.downloadSignalImgBtn?.addEventListener('click', downloadSignalSampleSvg);

  // 모달 내 다른 가상 예시 재생성 버튼
  el.regenSignalSampleBtn?.addEventListener('click', () => {
    openSignalSampleModal(state.currentSignalModalId, state.currentSignalModalName);
  });

  // Supabase 누적 학습 사례 필터 및 새로고침 버튼
  el.kbTypeFilter?.addEventListener('change', loadKnowledgeCases);
  el.refreshKbBtn?.addEventListener('click', loadKnowledgeCases);
}

// 브라우저 환경에서만 초기화 실행 (단위 테스트 임포트 시 DOM 오류 방지)
if (typeof document !== 'undefined') {
  initDomRefs();
  loadSessionStats();
  updateCharCount();
  bindEvents();
  checkServerHealth();
  loadKnowledgeCases();
}

